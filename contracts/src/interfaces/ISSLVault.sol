// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ISSLVault
 * @notice Interface for the Stealth Settlement Layer Vault
 * @dev Manages escrowed assets and executes confidential dark-pool settlements
 */
interface ISSLVault {
    // ──────────────────────────────────────────────
    //  Enums
    // ──────────────────────────────────────────────

    enum OrderSide {
        BUY,
        SELL
    }

    enum OrderStatus {
        OPEN,
        MATCHED,
        SETTLED,
        CANCELLED
    }

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    struct Order {
        uint256 orderId;
        address trader;
        address token; // token being offered
        uint256 amount; // amount of token offered
        uint256 price; // price per unit in settlement token
        OrderSide side;
        OrderStatus status;
        uint256 timestamp;
    }

    struct Settlement {
        uint256 settlementId;
        uint256 buyOrderId;
        uint256 sellOrderId;
        address buyer;
        address seller;
        address baseToken; // the asset (e.g. bond)
        address quoteToken; // the settlement token (e.g. USDC)
        uint256 baseAmount;
        uint256 quoteAmount;
        uint256 timestamp;
    }

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event Deposited(address indexed trader, address indexed token, uint256 amount);
    event Withdrawn(address indexed trader, address indexed token, uint256 amount);
    event OrderSubmitted(uint256 indexed orderId, address indexed trader, bytes32 encryptedOrderHash);
    event OrderCancelled(uint256 indexed orderId, address indexed trader);
    event SettlementExecuted(
        uint256 indexed settlementId,
        uint256 indexed buyOrderId,
        uint256 indexed sellOrderId,
        address buyer,
        address seller,
        uint256 baseAmount,
        uint256 quoteAmount
    );
    event CrossChainSettlementInitiated(
        uint256 indexed settlementId, uint64 destinationChainSelector, bytes32 messageId
    );

    // ──────────────────────────────────────────────
    //  Functions
    // ──────────────────────────────────────────────

    /// @notice Deposit tokens into the vault for trading
    function deposit(address token, uint256 amount) external;

    /// @notice Withdraw unencumbered tokens from the vault
    function withdraw(address token, uint256 amount) external;

    /// @notice Submit a private order (only hash stored on-chain)
    function submitOrder(
        address token,
        uint256 amount,
        uint256 price,
        OrderSide side,
        bytes32 encryptedOrderHash
    ) external returns (uint256 orderId);

    /// @notice Cancel an open order and release escrowed funds
    function cancelOrder(uint256 orderId) external;

    /// @notice Execute a matched settlement (called by operator/CRE)
    function executeSettlement(
        uint256 buyOrderId,
        uint256 sellOrderId,
        address baseToken,
        address quoteToken,
        uint256 baseAmount,
        uint256 quoteAmount
    ) external returns (uint256 settlementId);

    /// @notice Get a trader's deposited balance for a token
    function getBalance(address trader, address token) external view returns (uint256);

    /// @notice Get order details
    function getOrder(uint256 orderId) external view returns (Order memory);

    /// @notice Get settlement details
    function getSettlement(uint256 settlementId) external view returns (Settlement memory);
}
