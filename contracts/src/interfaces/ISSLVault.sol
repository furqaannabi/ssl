// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ISSLVault
 * @notice Interface for the Stealth Settlement Layer Vault
 * @dev World ID verification happens in CRE -> written to vault via report.
 *      Settlement data also arrives via CRE reports through the KeystoneForwarder.
 *
 *      Security invariants:
 *        - One nullifier = one wallet (nullifierOwner binding)
 *        - Settlement cannot exceed deposited balances
 *        - Only KeystoneForwarder can write reports
 */
interface ISSLVault {
    event Funded(address indexed token, uint256 amount, uint256 nullifierHash);
    event Verified(uint256 indexed nullifierHash);
    event Settled(bytes32 indexed orderId, address stealthBuyer, address stealthSeller);

    /// @notice Deposit tokens. Requires CRE-verified nullifier.
    ///         First fund binds nullifier to msg.sender permanently.
    function fund(address token, uint256 amount, uint256 nullifierHash) external;

    /// @notice Check if a nullifier has been verified by CRE
    function isVerified(uint256 nullifierHash) external view returns (bool);

    /// @notice Wallet bound to a nullifier (set on first fund)
    function nullifierOwner(uint256 nullifierHash) external view returns (address);

    /// @notice Balance per nullifier per token
    function balances(uint256 nullifierHash, address token) external view returns (uint256);

    /// @notice Check if an order has already been settled
    function settledOrders(bytes32 orderId) external view returns (bool);
}
