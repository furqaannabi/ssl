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
    struct WithdrawalRequest {
        address token;
        uint256 amount;
        bool claimed;
    }

    event Funded(address indexed token, uint256 amount, address indexed user);
    event Verified(address indexed user);
    event WithdrawalRequested(
        address indexed user,
        uint256 amount,
        uint256 withdrawalId,
        uint256 timestamp
    );
    event WithdrawalClaimed(
        address indexed user,
        uint256 withdrawalId,
        uint256 timestamp
    );
    event Settled(
        bytes32 indexed orderId,
        address stealthBuyer,
        address stealthSeller
    );
    event CrossChainSettled(
        bytes32 indexed orderId,
        uint64 destChainSelector,
        address recipient,
        bytes32 ccipMessageId
    );
    event TokenReleased(
        bytes32 indexed orderId,
        address recipient,
        address token,
        uint256 amount
    );
    event TokenWhitelisted(address indexed token, string symbol, uint8 tokenType);
    event TokenRemoved(address indexed token);

    /// @notice Deposit tokens. Requires CRE-verified nullifier.
    ///         First fund binds nullifier to msg.sender permanently.
    function fund(address token, uint256 amount) external;

    /// @notice Check if a nullifier has been verified by CRE
    function isVerified(address user) external view returns (bool);

    /// @notice Check if an order has already been settled
    function settledOrders(bytes32 orderId) external view returns (bool);

    /// @notice Request withdrawal of tokens
    function requestWithdrawal(address token, uint256 amount) external;

    /// @notice Get withdrawal requests for a user
    function getWithdrawalRequests(
        address user
    ) external view returns (uint256[] memory);

    function isTokenWhitelisted(address token) external view returns (bool);
    function whitelistToken(address token, string calldata symbol, string calldata name, uint8 tokenType) external;
    function removeToken(address token) external;
}
