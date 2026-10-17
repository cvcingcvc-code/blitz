// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SharedCounter — 反面教材：所有用户写同一个存储槽
/// @notice 每笔交易都对同一个 storage slot（slot 0）执行 SLOAD + SSTORE。
///         在 Monad 的乐观并行执行模型下，写同一槽的交易无法并行确认，
///         会触发串行重执行（依赖冲突），吞吐随并发用户数衰减。
/// @dev    存储布局：count 位于 slot 0，是唯一的写热点。
contract SharedCounter {
    /// @notice 共享热点：所有调用者读写同一 slot
    uint256 public count;

    event Incremented(address indexed caller, uint256 newCount);

    /// @notice 全体共享计数 +1（SLOAD slot0 + SSTORE slot0）
    function increment() external {
        count += 1;
        emit Incremented(msg.sender, count);
    }

    /// @notice 批量 +n，循环内重复写同一 slot，冲突面更大
    function incrementBy(uint256 n) external {
        require(n <= 10_000, "n too large");
        for (uint256 i = 0; i < n; i++) {
            count += 1;
        }
        emit Incremented(msg.sender, count);
    }
}
