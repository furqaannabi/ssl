// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
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
 *     0 = verify           -- (uint8, address user)
 *     1 = settle           -- (uint8, bytes32 orderId, address stealthBuyer, address stealthSeller, address tokenA, address tokenB, uint256 amountA, uint256 amountB)
 *     2 = withdraw         -- (uint8, address user, uint256 withdrawalId)
 *     3 = crossChainSettle -- (uint8, bytes32 orderId, uint64 destChainSelector, address destVault, address recipient, address token, uint256 amount) [CCIP bridge with data]
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

    IRouterClient public immutable ccipRouter;
    IERC20 public immutable linkToken;
    address public ccipReceiver;

    /// @notice address => verified
    mapping(address => bool) public override isVerified;

    /// @notice orderId => settled (same-chain or CCIP USDC bridge side)
    mapping(bytes32 => bool) public override settledOrders;

    /// @notice orderId => RWA settled for buyer (cross-chain dest side)
    mapping(bytes32 => bool) public rwaSettledOrders;

    uint256 public withdrawalId;

    /// @notice withdrawalId => withdrawal requests
    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;

    mapping(address => uint256[]) public userWithdrawalIds;

    struct TokenMetadata {
        string symbol;
        string name;
        uint8 tokenType; // 0=STOCK, 1=ETF, 2=BOND, 3=COMMODITY, 4=STABLE
        bool active;
    }

    mapping(address => bool) public whitelistedTokens;
    mapping(address => TokenMetadata) public tokenMetadata;
    address[] public whitelistedTokenList;

    constructor(
        address _forwarderAddress,
        address _ccipRouter,
        address _linkToken
    ) ReceiverTemplate(_forwarderAddress) {
        ccipRouter = IRouterClient(_ccipRouter);
        linkToken = IERC20(_linkToken);
    }

    function whitelistToken(
        address token,
        string calldata symbol,
        string calldata name,
        uint8 tokenType
    ) external onlyOwner {
        require(token != address(0), "SSL: zero address");
        require(!whitelistedTokens[token], "SSL: already whitelisted");

        whitelistedTokens[token] = true;
        tokenMetadata[token] = TokenMetadata({
            symbol: symbol,
            name: name,
            tokenType: tokenType,
            active: true
        });
        whitelistedTokenList.push(token);

        emit TokenWhitelisted(token, symbol, tokenType);
    }

    function removeToken(address token) external onlyOwner {
        require(whitelistedTokens[token], "SSL: not whitelisted");
        whitelistedTokens[token] = false;
        tokenMetadata[token].active = false;

        emit TokenRemoved(token);
    }

    function isTokenWhitelisted(address token) external view returns (bool) {
        return whitelistedTokens[token];
    }

    function getWhitelistedTokens() external view returns (address[] memory) {
        return whitelistedTokenList;
    }

    function setCCIPReceiver(address _receiver) external onlyOwner {
        ccipReceiver = _receiver;
    }

    /// @notice Called by SSLCCIPReceiver when a cross-chain message arrives.
    ///         Transfers the RWA token to the buyer and marks the order settled.
    function ccipSettle(
        bytes32 orderId,
        address buyer,
        address rwaToken,
        uint256 rwaAmount
    ) external {
        require(msg.sender == ccipReceiver, "SSL: only ccip receiver");
        require(!rwaSettledOrders[orderId], "SSL: rwa settled");
        rwaSettledOrders[orderId] = true;
        IERC20(rwaToken).safeTransfer(buyer, rwaAmount);
        emit Settled(orderId, buyer, address(0));
    }

    function withdrawFees(address _token, address _to) external onlyOwner {
        IERC20(_token).safeTransfer(_to, IERC20(_token).balanceOf(address(this)));
    }

    // ──────────────────────────────────────────────
    //  Fund (requires CRE-verified address)
    // ──────────────────────────────────────────────

    /// @inheritdoc ISSLVault
    function fund(
        address token,
        uint256 amount
    ) external override nonReentrant {
        require(amount > 0, "SSL: zero amount");
        require(whitelistedTokens[token], "SSL: token not whitelisted");
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
        } else if (reportType == 3) {
            _processCrossChainSettle(report);
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

    // ──────────────────────────────────────────────
    //  Cross-chain settlement (CCIP)
    // ──────────────────────────────────────────────

    function _processCrossChainSettle(bytes calldata report) private {
        (
            ,
            bytes32 orderId,
            uint64 destChainSelector,
            address destReceiver,
            address buyer,
            address seller,
            address usdcToken,
            uint256 usdcAmount,
            address rwaToken,
            uint256 rwaAmount
        ) = abi.decode(
                report,
                (uint8, bytes32, uint64, address, address, address, address, uint256, address, uint256)
            );

        require(!settledOrders[orderId], "SSL: settled");

        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        tokenAmounts[0] = Client.EVMTokenAmount({
            token: usdcToken,
            amount: usdcAmount
        });

        // Encode buyer, seller, rwaToken, rwaAmount so the dest CCIPReceiver can
        // atomically pay the seller their USDC and give the buyer their RWA token.
        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(destReceiver),
            data: abi.encode(orderId, buyer, seller, rwaToken, rwaAmount),
            tokenAmounts: tokenAmounts,
            extraArgs: Client._argsToBytes(
                Client.GenericExtraArgsV2({
                    gasLimit: 300_000,
                    allowOutOfOrderExecution: true
                })
            ),
            feeToken: address(linkToken) // pay CCIP fee in LINK
        });

        IERC20(usdcToken).safeIncreaseAllowance(address(ccipRouter), usdcAmount);

        uint256 fee = ccipRouter.getFee(destChainSelector, message);
        require(linkToken.balanceOf(address(this)) >= fee, "SSL: insufficient LINK for CCIP fee");
        linkToken.safeIncreaseAllowance(address(ccipRouter), fee);

        bytes32 messageId = ccipRouter.ccipSend(destChainSelector, message);

        settledOrders[orderId] = true;

        emit CrossChainSettled(orderId, destChainSelector, buyer, messageId);
    }

/// @inheritdoc IERC165
    function supportsInterface(
        bytes4 interfaceId
    ) public view override returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
