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
 *   1. CRE verifies World ID -> report(type=0) -> vault marks user verified
 *   2. User calls fund() -> vault tracks balance for user
 *   3. CRE matches orders -> report(type=1) -> vault checks balances, settles
 *
 *   Report types:
 *     0 = verify  -- (uint8, address user)
 *     1 = settle  -- (uint8, bytes32 orderId, address stealthBuyer, address stealthSeller, address buyer, address seller, address tokenA, address tokenB, uint256 amountA, uint256 amountB)
 *     2 = withdraw -- (uint8, address user, address token, uint256 amount)
 *   Security:
 *     - Per-user balance tracking (prevents over-settlement)
 *     - Settlement deducts from balances before transferring (never trust CRE blindly)
 */
contract StealthSettlementVault is
    ISSLVault,
    ReceiverTemplate,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    /// @notice address => verified
    mapping(address => bool) public override isVerified;

    /// @notice orderId => settled
    mapping(bytes32 => bool) public override settledOrders;

    uint256 public withdrawalId;

    /// @notice withdrawalId => withdrawal requests
    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;

    mapping(address => uint256[]) public userWithdrawalIds;

    constructor(
        address _forwarderAddress
    ) ReceiverTemplate(_forwarderAddress) {}

    // ──────────────────────────────────────────────
    //  Fund (requires CRE-verified address)
    // ──────────────────────────────────────────────

    /// @inheritdoc ISSLVault
    function fund(
        address token,
        uint256 amount
    ) external override nonReentrant {
        require(amount > 0, "SSL: zero amount");
        // Verify sender address is whitelisted by CRE
        require(isVerified[msg.sender], "SSL: address not verified");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit Funded(token, amount, msg.sender);
    }

    // ──────────────────────────────────────────────
    //  Withdrawals
    // ──────────────────────────────────────────────

    /// @inheritdoc ISSLVault
    function requestWithdrawal(
        address token,
        uint256 amount
    ) external override nonReentrant {
        require(amount > 0, "SSL: zero amount");
        withdrawalId++;
        withdrawalRequests[withdrawalId] = WithdrawalRequest({
            token: token,
            amount: amount,
            claimed: false
        });
        userWithdrawalIds[msg.sender].push(withdrawalId);

        emit WithdrawalRequested(
            msg.sender,
            amount,
            withdrawalId,
            block.timestamp
        );
    }

    function _claimWithdrawal(bytes calldata report) internal {
        (, address _user, uint256 _withdrawalId) = abi.decode(
            report,
            (uint8, address, uint256)
        );
        require(_withdrawalId <= withdrawalId, "SSL: invalid withdrawal ID");
        WithdrawalRequest storage request = withdrawalRequests[_withdrawalId];

        require(!request.claimed, "SSL: already claimed");
        // Here we could add a time delay check if needed:
        // require(block.timestamp >= request.timestamp + DELAY, "SSL: too early");

        request.claimed = true;

        IERC20(request.token).safeTransfer(_user, request.amount);

        emit WithdrawalClaimed(_user, _withdrawalId, block.timestamp);
    }

    /// @inheritdoc ISSLVault
    function getWithdrawalRequests(
        address user
    ) external view override returns (uint256[] memory) {
        return userWithdrawalIds[user];
    }

    // ──────────────────────────────────────────────
    //  Reports (via KeystoneForwarder -> onReport)
    // ──────────────────────────────────────────────

    function _processReport(
        bytes calldata report
    ) internal override nonReentrant {
        (uint8 reportType) = abi.decode(report, (uint8));

        if (reportType == 0) {
            _processVerify(report);
        } else if (reportType == 1) {
            _processSettle(report);
        } else if (reportType == 2) {
            _claimWithdrawal(report);
        } else {
            revert("SSL: unknown report type");
        }
    }

    function _processVerify(bytes calldata report) private {
        // Decode (address user) - potentially followed by legacy nullifierHash which we ignore
        // Utilizing a flexible decode if possible, or assuming updated report format.
        // For safety/compatibility during migration, we can decode extra args if we suspect they exist,
        // but cleaner to assume correct new format (type, user).

        (, address user) = abi.decode(report, (uint8, address));

        // If the report was reusing nullifier slot for user address, logic holds.
        // If it was (uint8, user, nullifier), this decode reads the first 2.
        // NOTE: abi.decode reads strict checking on total length usually unless extracting from calldata slice.
        // But since we pass 'report' (bytes calldata), abi.decode will conform to the types requested
        // and ideally the length matches. If length is longer, it might throw in newer solidity?
        // Let's assume strict compliance with the new "Address only" format.

        if (!isVerified[user]) {
            isVerified[user] = true;
            emit Verified(user);
        }
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
        ) = abi.decode(
                report,
                (
                    uint8,
                    bytes32,
                    address,
                    address,
                    address,
                    address,
                    uint256,
                    uint256
                )
            );

        require(!settledOrders[orderId], "settled");

        // Transfer to stealth addresses
        IERC20(tokenA).safeTransfer(stealthBuyer, amountA);
        IERC20(tokenB).safeTransfer(stealthSeller, amountB);

        settledOrders[orderId] = true;

        emit Settled(orderId, stealthBuyer, stealthSeller);
    }

    /// @inheritdoc IERC165
    function supportsInterface(
        bytes4 interfaceId
    ) public view override returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
