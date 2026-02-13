// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/ISSLVault.sol";
import "./ReceiverTemplate.sol";

/**
 * @title StealthSettlementVault
 * @notice Stealth Settlement Layer
 * @dev
 *   1. User sends World ID proof to Backend → Backend sends to CRE
 *   2. CRE verifies World ID → sends report(type=0) → vault marks nullifier verified
 *   3. User calls fund() → vault checks isVerified, accepts deposit
 *   4. Backend sends order to CRE → CRE matches → sends report(type=1) → vault settles
 *
 *   Report types:
 *     0 = verify  — (uint8, uint256 nullifierHash)
 *     1 = settle   — (uint8, bytes32 orderId, address stealthBuyer, address stealthSeller,
 *                      address tokenA, address tokenB, uint256 amountA, uint256 amountB)
 */
contract StealthSettlementVault is ISSLVault, ReceiverTemplate, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice nullifierHash => verified
    mapping(uint256 => bool) public override isVerified;

    /// @notice orderId => settled
    mapping(bytes32 => bool) public override settledOrders;

    constructor(
        address _forwarderAddress
    ) ReceiverTemplate(_forwarderAddress) {}

    // ──────────────────────────────────────────────
    //  Fund (requires CRE-verified nullifier)
    // ──────────────────────────────────────────────

    /// @inheritdoc ISSLVault
    function fund(
        address token,
        uint256 amount,
        uint256 nullifierHash
    ) external override nonReentrant {
        require(amount > 0, "SSL: zero amount");
        require(isVerified[nullifierHash], "SSL: not verified");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit Funded(token, amount, nullifierHash);
    }

    // ──────────────────────────────────────────────
    //  Reports (via KeystoneForwarder → onReport)
    // ──────────────────────────────────────────────

    function _processReport(bytes calldata report) internal override nonReentrant {
        uint8 reportType = uint8(report[0]);

        if (reportType == 0) {
            _processVerify(report);
        } else if (reportType == 1) {
            _processSettle(report);
        } else {
            revert("SSL: unknown report type");
        }
    }

    function _processVerify(bytes calldata report) private {
        (, uint256 nullifierHash) = abi.decode(report, (uint8, uint256));
        require(!isVerified[nullifierHash], "SSL: already verified");
        isVerified[nullifierHash] = true;
        emit ISSLVault.Verified(nullifierHash);
    }

    function _processSettle(bytes calldata report) private {
        (
            ,
            bytes32 orderId,
            address stealthBuyer,
            address stealthSeller,
            address tokenA,
            address tokenB,
            uint256 amountA,
            uint256 amountB
        ) = abi.decode(report, (uint8, bytes32, address, address, address, address, uint256, uint256));

        require(!settledOrders[orderId], "settled");

        IERC20(tokenA).safeTransfer(stealthSeller, amountA);
        IERC20(tokenB).safeTransfer(stealthBuyer, amountB);

        settledOrders[orderId] = true;

        emit Settled(orderId, stealthBuyer, stealthSeller);
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
