// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SharedCounter.sol";
import "../src/IndependentRecorder.sol";

/// @title SlotShift 合约测试
/// @notice 验证两份合约的功能正确性与存储隔离行为。
///         注意：单元测试只验证逻辑，不测量真实并行调度——并行行为
///         只能在 Monad 测试网用真实交易观察，且前端明确区分模拟与实测。
contract SlotShiftTest is Test {
    SharedCounter shared;
    IndependentRecorder independent;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        shared = new SharedCounter();
        independent = new IndependentRecorder();
    }

    // ---------- SharedCounter：功能正确 ----------

    function test_SharedCounter_increment() public {
        shared.increment();
        assertEq(shared.count(), 1);
    }

    function test_SharedCounter_incrementTwice() public {
        shared.increment();
        shared.increment();
        assertEq(shared.count(), 2);
    }

    function test_SharedCounter_incrementBy() public {
        shared.incrementBy(5);
        assertEq(shared.count(), 5);
    }

    function test_SharedCounter_multipleUsersShareSameSlot() public {
        vm.prank(alice);
        shared.increment();
        vm.prank(bob);
        shared.increment();
        vm.prank(carol);
        shared.increment();
        // 三人的写入全部落在同一个全局计数器上——这正是冲突根源
        assertEq(shared.count(), 3);
    }

    function test_SharedCounter_revertWhenNTooLarge() public {
        vm.expectRevert(bytes("n too large"));
        shared.incrementBy(10_001);
    }

    // ---------- IndependentRecorder：功能正确 + 存储隔离 ----------

    function test_IndependentRecorder_record() public {
        vm.prank(alice);
        independent.record(42);
        assertEq(independent.records(alice), 42);
    }

    function test_IndependentRecorder_isolatedPerAddress() public {
        vm.prank(alice);
        independent.record(1);
        vm.prank(bob);
        independent.record(2);
        vm.prank(carol);
        independent.record(3);
        // 每个地址各写各的槽，互不影响
        assertEq(independent.records(alice), 1);
        assertEq(independent.records(bob), 2);
        assertEq(independent.records(carol), 3);
    }

    function test_IndependentRecorder_overwrite() public {
        vm.prank(alice);
        independent.record(10);
        vm.prank(alice);
        independent.record(20);
        assertEq(independent.records(alice), 20);
    }

    function test_IndependentRecorder_myRecord() public {
        vm.prank(bob);
        independent.record(7);
        vm.prank(bob);
        assertEq(independent.myRecord(), 7);
    }

    function test_IndependentRecorder_noGlobalCounter() public {
        // 优化版没有全局 count 可写：任何用户 record 后，
        // 其他地址的记录仍是 0（无共享状态）
        vm.prank(alice);
        independent.record(999);
        assertEq(independent.records(bob), 0);
    }

    // ---------- 存储布局证明：槽位地址不同 ----------

    function test_StorageSlotIsolation() public {
        // SharedCounter：所有写入都在 slot 0
        bytes32 sharedSlot = vm.load(address(shared), bytes32(uint256(0)));
        vm.prank(alice);
        shared.increment();
        bytes32 sharedSlotAfter = vm.load(address(shared), bytes32(uint256(0)));
        assertTrue(sharedSlot != sharedSlotAfter, "slot0 must be written");

        // IndependentRecorder：records 位于 slot 0，
        // alice 的写入在 keccak256(abi.encode(alice, 0))
        bytes32 aliceSlot = keccak256(abi.encode(alice, uint256(0)));
        bytes32 before = vm.load(address(independent), aliceSlot);
        vm.prank(alice);
        independent.record(123);
        bytes32 after_ = vm.load(address(independent), aliceSlot);
        assertTrue(before != after_, "alice slot must be written");

        // bob 的槽与 alice 的槽完全不同
        bytes32 bobSlot = keccak256(abi.encode(bob, uint256(0)));
        assertEq(bobSlot == aliceSlot, false);
    }
}
