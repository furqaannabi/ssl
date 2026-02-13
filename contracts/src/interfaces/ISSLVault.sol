// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ISSLVault
 * @notice Interface for the Stealth Settlement Layer Vault
 * @dev World ID verification happens in CRE → written to vault via report.
 *      Settlement data also arrives via CRE reports through the KeystoneForwarder.
 */
interface ISSLVault {
    event Funded(address indexed token, uint256 amount, uint256 nullifierHash);
    event Verified(uint256 indexed nullifierHash);
    event Settled(bytes32 indexed orderId, address stealthBuyer, address stealthSeller);

    /// @notice Deposit tokens into the vault. Requires CRE-verified nullifier.
    /// @param token Token address to deposit
    /// @param amount Amount to deposit
    /// @param nullifierHash CRE-verified nullifier hash
    function fund(address token, uint256 amount, uint256 nullifierHash) external;

    /// @notice Check if a nullifier has been verified by CRE
    function isVerified(uint256 nullifierHash) external view returns (bool);

    /// @notice Check if an order has already been settled
    function settledOrders(bytes32 orderId) external view returns (bool);
}
