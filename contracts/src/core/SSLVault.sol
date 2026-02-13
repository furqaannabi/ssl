// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/ISSLVault.sol";

/**
 * @title StealthSettlementVault
 * @notice Stealth Settlement Layer — Confidential trading vault with stealth address settlement
 * @dev Holds assets and executes settlements to one-time stealth addresses.
 *      - Users are verified via World ID (anti-sybil, off-chain in CRE)
 *      - Orders are matched confidentially inside CRE
 *      - CRE generates stealth addresses for each party
 *      - Settlement sends funds directly to stealth addresses
 *      - No order logic on-chain — only final settlement is visible
 */
contract StealthSettlementVault is ISSLVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    /// @notice CRE signer address (the only address that can trigger settlements)
    address public creSigner;

    /// @notice orderId => whether the order has been settled
    mapping(bytes32 => bool) public override settledOrders;

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier onlyCRE() {
        require(msg.sender == creSigner, "not CRE");
        _;
    }

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor(address _creSigner) {
        creSigner = _creSigner;
    }

    // ──────────────────────────────────────────────
    //  Fund
    // ──────────────────────────────────────────────

    /// @inheritdoc ISSLVault
    function fund(
        address token,
        uint256 amount
    ) external override nonReentrant {
        require(amount > 0, "SSL: zero amount");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(token, amount);
    }

    // ──────────────────────────────────────────────
    //  Settlement (called by CRE)
    // ──────────────────────────────────────────────

    /// @inheritdoc ISSLVault
    function settle(
        bytes32 orderId,
        address stealthBuyer,
        address stealthSeller,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external override nonReentrant onlyCRE {
        require(!settledOrders[orderId], "settled");

        IERC20(tokenA).safeTransfer(stealthSeller, amountA);
        IERC20(tokenB).safeTransfer(stealthBuyer, amountB);

        settledOrders[orderId] = true;

        emit Settled(orderId, stealthBuyer, stealthSeller);
    }
}
