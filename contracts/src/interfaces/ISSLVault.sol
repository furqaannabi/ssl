// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ISSLVault
 * @notice Interface for the Stealth Settlement Layer Vault
 * @dev Holds assets and executes settlements to stealth addresses.
 *      Orders are matched confidentially off-chain inside CRE,
 *      identity is verified via World ID (anti-sybil),
 *      and funds are sent to one-time stealth addresses.
 */
interface ISSLVault {
    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event Funded(address indexed token, uint256 amount);

    event Settled(
        bytes32 indexed orderId,
        address stealthBuyer,
        address stealthSeller
    );

    // ──────────────────────────────────────────────
    //  Functions
    // ──────────────────────────────────────────────

    /// @notice Fund the vault with tokens for settlement
    function fund(address token, uint256 amount) external;

    /// @notice Execute a matched settlement — sends tokens to stealth addresses
    function settle(
        bytes32 orderId,
        address stealthBuyer,
        address stealthSeller,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external;

    /// @notice Check if an order has already been settled
    function settledOrders(bytes32 orderId) external view returns (bool);
}
