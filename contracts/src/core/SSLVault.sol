// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/ISSLVault.sol";
import "../interfaces/IACEComplianceAdapter.sol";

/**
 * @title SSLVault
 * @notice Stealth Settlement Layer — Confidential RWA Dark Pool Vault
 * @dev Holds escrowed assets, accepts private orders, and executes atomic settlements.
 *      The matching engine runs off-chain inside a TEE (Chainlink CRE),
 *      and only the final settlement is recorded on-chain.
 */
contract SSLVault is ISSLVault, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    /// @notice ACE compliance adapter
    IACEComplianceAdapter public complianceAdapter;

    /// @notice Operator address (CRE / matching engine)
    address public operator;

    /// @notice trader => token => balance
    mapping(address => mapping(address => uint256)) private _balances;

    /// @notice trader => token => escrowed (locked in open orders)
    mapping(address => mapping(address => uint256)) private _escrowed;

    /// @notice orderId => Order
    mapping(uint256 => Order) private _orders;

    /// @notice settlementId => Settlement
    mapping(uint256 => Settlement) private _settlements;

    uint256 private _nextOrderId = 1;
    uint256 private _nextSettlementId = 1;

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier onlyOperator() {
        require(
            msg.sender == operator || msg.sender == owner(),
            "SSL: not operator"
        );
        _;
    }

    modifier onlyCompliant(address wallet) {
        require(
            complianceAdapter.isCompliant(wallet),
            "SSL: wallet not compliant"
        );
        _;
    }

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor(
        address _complianceAdapter,
        address _operator
    ) Ownable(msg.sender) {
        complianceAdapter = IACEComplianceAdapter(_complianceAdapter);
        operator = _operator;
    }

    // ──────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
    }

    function setComplianceAdapter(
        address _complianceAdapter
    ) external onlyOwner {
        complianceAdapter = IACEComplianceAdapter(_complianceAdapter);
    }

    // ──────────────────────────────────────────────
    //  Deposit / Withdraw
    // ──────────────────────────────────────────────

    /// @inheritdoc ISSLVault
    function deposit(
        address token,
        uint256 amount
    ) external override nonReentrant onlyCompliant(msg.sender) {
        require(amount > 0, "SSL: zero amount");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _balances[msg.sender][token] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    /// @inheritdoc ISSLVault
    function withdraw(
        address token,
        uint256 amount
    ) external override nonReentrant {
        uint256 available = _balances[msg.sender][token] -
            _escrowed[msg.sender][token];
        require(
            amount > 0 && amount <= available,
            "SSL: insufficient available balance"
        );
        _balances[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    // ──────────────────────────────────────────────
    //  Order Management
    // ──────────────────────────────────────────────

    /// @inheritdoc ISSLVault
    function submitOrder(
        address token,
        uint256 amount,
        uint256 price,
        OrderSide side,
        bytes32 encryptedOrderHash
    )
        external
        override
        nonReentrant
        onlyCompliant(msg.sender)
        returns (uint256 orderId)
    {
        require(amount > 0 && price > 0, "SSL: invalid params");

        // Ensure trader has enough deposited balance
        uint256 available = _balances[msg.sender][token] -
            _escrowed[msg.sender][token];
        require(available >= amount, "SSL: insufficient balance for order");

        orderId = _nextOrderId++;

        _orders[orderId] = Order({
            orderId: orderId,
            trader: msg.sender,
            token: token,
            amount: amount,
            price: price,
            side: side,
            status: OrderStatus.OPEN,
            timestamp: block.timestamp
        });

        // Lock the tokens
        _escrowed[msg.sender][token] += amount;

        emit OrderSubmitted(orderId, msg.sender, encryptedOrderHash);
    }

    /// @inheritdoc ISSLVault
    function cancelOrder(uint256 orderId) external override nonReentrant {
        Order storage order = _orders[orderId];
        require(order.trader == msg.sender, "SSL: not order owner");
        require(order.status == OrderStatus.OPEN, "SSL: order not open");

        order.status = OrderStatus.CANCELLED;

        // Release escrowed tokens
        _escrowed[msg.sender][order.token] -= order.amount;

        emit OrderCancelled(orderId, msg.sender);
    }

    // ──────────────────────────────────────────────
    //  Settlement (called by CRE operator)
    // ──────────────────────────────────────────────

    /// @inheritdoc ISSLVault
    function executeSettlement(
        uint256 buyOrderId,
        uint256 sellOrderId,
        address baseToken,
        address quoteToken,
        uint256 baseAmount,
        uint256 quoteAmount
    )
        external
        override
        nonReentrant
        onlyOperator
        returns (uint256 settlementId)
    {
        Order storage buyOrder = _orders[buyOrderId];
        Order storage sellOrder = _orders[sellOrderId];

        // ── Validate orders ──
        require(buyOrder.status == OrderStatus.OPEN, "SSL: buy order not open");
        require(
            sellOrder.status == OrderStatus.OPEN,
            "SSL: sell order not open"
        );
        require(buyOrder.side == OrderSide.BUY, "SSL: not a buy order");
        require(sellOrder.side == OrderSide.SELL, "SSL: not a sell order");

        address buyer = buyOrder.trader;
        address seller = sellOrder.trader;

        // ── ACE compliance check ──
        require(
            complianceAdapter.checkTradeCompliance(buyer, seller, quoteAmount),
            "SSL: compliance check failed"
        );

        // ── Execute atomic swap ──
        // Seller gives baseToken (bonds), Buyer gives quoteToken (USDC)
        require(
            _escrowed[seller][baseToken] >= baseAmount,
            "SSL: seller insufficient escrow"
        );
        require(
            _escrowed[buyer][quoteToken] >= quoteAmount,
            "SSL: buyer insufficient escrow"
        );

        // Deduct from escrow and balances
        _escrowed[seller][baseToken] -= baseAmount;
        _balances[seller][baseToken] -= baseAmount;
        _escrowed[buyer][quoteToken] -= quoteAmount;
        _balances[buyer][quoteToken] -= quoteAmount;

        // Credit swapped assets
        _balances[buyer][baseToken] += baseAmount;
        _balances[seller][quoteToken] += quoteAmount;

        // ── Update order statuses ──
        buyOrder.status = OrderStatus.SETTLED;
        sellOrder.status = OrderStatus.SETTLED;

        // ── Record settlement ──
        settlementId = _nextSettlementId++;
        _settlements[settlementId] = Settlement({
            settlementId: settlementId,
            buyOrderId: buyOrderId,
            sellOrderId: sellOrderId,
            buyer: buyer,
            seller: seller,
            baseToken: baseToken,
            quoteToken: quoteToken,
            baseAmount: baseAmount,
            quoteAmount: quoteAmount,
            timestamp: block.timestamp
        });

        emit SettlementExecuted(
            settlementId,
            buyOrderId,
            sellOrderId,
            buyer,
            seller,
            baseAmount,
            quoteAmount
        );
    }

    // ──────────────────────────────────────────────
    //  Cross-chain settlement (called by CCIPReceiver)
    // ──────────────────────────────────────────────

    /**
     * @notice Execute a settlement instruction received via CCIP
     * @dev Only callable by the CCIP receiver contract (set as operator)
     */
    function executeCrossChainSettlement(
        address buyer,
        address seller,
        address baseToken,
        address quoteToken,
        uint256 baseAmount,
        uint256 quoteAmount
    ) external nonReentrant onlyOperator returns (uint256 settlementId) {
        // ── ACE compliance ──
        require(
            complianceAdapter.checkTradeCompliance(buyer, seller, quoteAmount),
            "SSL: compliance check failed"
        );

        // ── Execute swap from vault balances ──
        require(
            _balances[seller][baseToken] >= baseAmount,
            "SSL: seller insufficient balance"
        );
        require(
            _balances[buyer][quoteToken] >= quoteAmount,
            "SSL: buyer insufficient balance"
        );

        _balances[seller][baseToken] -= baseAmount;
        _balances[buyer][quoteToken] -= quoteAmount;
        _balances[buyer][baseToken] += baseAmount;
        _balances[seller][quoteToken] += quoteAmount;

        // ── Record ──
        settlementId = _nextSettlementId++;
        _settlements[settlementId] = Settlement({
            settlementId: settlementId,
            buyOrderId: 0, // cross-chain — no local order
            sellOrderId: 0,
            buyer: buyer,
            seller: seller,
            baseToken: baseToken,
            quoteToken: quoteToken,
            baseAmount: baseAmount,
            quoteAmount: quoteAmount,
            timestamp: block.timestamp
        });

        emit SettlementExecuted(
            settlementId,
            0,
            0,
            buyer,
            seller,
            baseAmount,
            quoteAmount
        );
    }

    // ──────────────────────────────────────────────
    //  View functions
    // ──────────────────────────────────────────────

    /// @inheritdoc ISSLVault
    function getBalance(
        address trader,
        address token
    ) external view override returns (uint256) {
        return _balances[trader][token];
    }

    /// @notice Get escrowed (locked) balance
    function getEscrowedBalance(
        address trader,
        address token
    ) external view returns (uint256) {
        return _escrowed[trader][token];
    }

    /// @notice Get available (withdrawable) balance
    function getAvailableBalance(
        address trader,
        address token
    ) external view returns (uint256) {
        return _balances[trader][token] - _escrowed[trader][token];
    }

    /// @inheritdoc ISSLVault
    function getOrder(
        uint256 orderId
    ) external view override returns (Order memory) {
        return _orders[orderId];
    }

    /// @inheritdoc ISSLVault
    function getSettlement(
        uint256 settlementId
    ) external view override returns (Settlement memory) {
        return _settlements[settlementId];
    }

    /// @notice Total number of orders created
    function totalOrders() external view returns (uint256) {
        return _nextOrderId - 1;
    }

    /// @notice Total number of settlements
    function totalSettlements() external view returns (uint256) {
        return _nextSettlementId - 1;
    }
}
