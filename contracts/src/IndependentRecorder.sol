// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IndependentRecorder — 优化版：按地址隔离存储
/// @notice 每个地址只写自己的 storage slot（keccak256(abi.encode(addr, slot))），
///         不同用户的交易访问完全不同的槽，无写-写冲突，天然并行友好。
///         不维护任何全局计数器，彻底消除共享热点。
/// @dev    存储布局：mapping(address => uint256)，每地址一个独立槽。
contract IndependentRecorder {
    /// @notice 按地址隔离的记录
    mapping(address => uint256) public records;

    event Recorded(address indexed caller, uint256 value);

    /// @notice 只写调用者自己的槽（SSTORE keccak(msg.sender . slot1)）
    function record(uint256 value) external {
        records[msg.sender] = value;
        emit Recorded(msg.sender, value);
    }

    /// @notice 读取调用者自己的记录
    function myRecord() external view returns (uint256) {
        return records[msg.sender];
    }
}
