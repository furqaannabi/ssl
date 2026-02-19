// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/core/SSLVault.sol";
import "../src/mocks/MockBondToken.sol";
import "../src/mocks/MockUSDC.sol";
import "../src/interfaces/ISSLVault.sol";
import "../src/interfaces/IReceiver.sol";
import "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import "@chainlink/contracts-ccip/contracts/libraries/Client.sol";

// ── Minimal mock router for unit tests ──
contract MockCCIPRouter is IRouterClient {
    uint256 public s_fee;
    bytes32 public s_mockMessageId = keccak256("mockMessageId");

    function setFee(uint256 fee) external { s_fee = fee; }
    function setMockMessageId(bytes32 id) external { s_mockMessageId = id; }
    function isChainSupported(uint64) external pure returns (bool) { return true; }
    function getFee(uint64, Client.EVM2AnyMessage memory) external view returns (uint256) { return s_fee; }
    function ccipSend(uint64, Client.EVM2AnyMessage calldata) external payable returns (bytes32) {
        return s_mockMessageId;
    }
}

contract SSLVaultTest is Test {
    StealthSettlementVault public vault;
    MockBondToken public bondToken;
    MockUSDC public usdc;
    MockUSDC public linkToken;
    MockCCIPRouter public ccipRouter;

    address public forwarder = makeAddr("forwarder");
    address public seller = makeAddr("seller");
    address public buyer = makeAddr("buyer");
    address public stealthBuyer = makeAddr("stealthBuyer");
    address public stealthSeller = makeAddr("stealthSeller");

    uint256 public constant BOND_AMOUNT = 10_000e18;
    uint256 public constant USDC_AMOUNT = 1_005_000e6;
    uint256 public constant LINK_AMOUNT = 100e18;

    function setUp() public {
        bondToken = new MockBondToken();
        usdc = new MockUSDC();
        linkToken = new MockUSDC();
        ccipRouter = new MockCCIPRouter();

        vault = new StealthSettlementVault(forwarder, address(ccipRouter), address(linkToken));

        // Mint tokens
        bondToken.mint(seller, BOND_AMOUNT * 10);
        usdc.mint(buyer, USDC_AMOUNT * 10);
        linkToken.mint(address(vault), LINK_AMOUNT); // vault needs LINK to pay CCIP fees
    }

    // ── Helpers ──

    function _verifyViaReport(address user) internal {
        bytes memory report = abi.encode(uint8(0), user);
        vm.prank(forwarder);
        vault.onReport("", report);
    }

    function _fundAfterVerify(
        address user,
        address token,
        uint256 amount
    ) internal {
        _verifyViaReport(user);
        vm.prank(user);
        IERC20(token).approve(address(vault), amount);
        vm.prank(user);
        vault.fund(token, amount);
    }

    function _encodeSettleReport(
        bytes32 orderId,
        address _stealthBuyer,
        address _stealthSeller,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) internal pure returns (bytes memory) {
        return
            abi.encode(
                uint8(1),
                orderId,
                _stealthBuyer,
                _stealthSeller,
                tokenA,
                tokenB,
                amountA,
                amountB
            );
    }

    function _settleViaReport(
        bytes32 orderId,
        uint256 amountA,
        uint256 amountB
    ) internal {
        bytes memory report = _encodeSettleReport(
            orderId,
            stealthBuyer,
            stealthSeller,
            address(bondToken),
            address(usdc),
            amountA,
            amountB
        );
        vm.prank(forwarder);
        vault.onReport("", report);
    }

    function _encodeCrossChainSettleReport(
        bytes32 orderId,
        uint64 destChainSelector,
        address destVault,
        address recipient,
        address token,
        uint256 amount
    ) internal pure returns (bytes memory) {
        return abi.encode(
            uint8(3),
            orderId,
            destChainSelector,
            destVault,
            recipient,
            token,
            amount
        );
    }

    function _setupFundedVault() internal {
        // Seller deposits bondToken, buyer deposits USDC
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT);
        _fundAfterVerify(buyer, address(usdc), USDC_AMOUNT);
    }

    // ── Verify via Report ──

    function test_VerifyViaReport() public {
        _verifyViaReport(seller);
        assertTrue(vault.isVerified(seller));
    }

    function test_VerifyEmitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit ISSLVault.Verified(seller);
        _verifyViaReport(seller);
    }

    function test_VerifyIdempotent() public {
        _verifyViaReport(seller);
        // Second verify on same address should not revert and emit no event
        vm.recordLogs();
        _verifyViaReport(seller);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 0);
        assertTrue(vault.isVerified(seller));
    }

    // ── Fund ──

    function test_FundSuccess() public {
        _verifyViaReport(seller);

        vm.prank(seller);
        bondToken.approve(address(vault), BOND_AMOUNT);

        vm.expectEmit(true, false, false, true);
        emit ISSLVault.Funded(address(bondToken), BOND_AMOUNT, seller);

        vm.prank(seller);
        vault.fund(address(bondToken), BOND_AMOUNT);

        assertEq(bondToken.balanceOf(address(vault)), BOND_AMOUNT);
    }

    function test_FundMultipleDeposits() public {
        _verifyViaReport(seller);

        vm.prank(seller);
        bondToken.approve(address(vault), BOND_AMOUNT * 2);

        vm.prank(seller);
        vault.fund(address(bondToken), BOND_AMOUNT);

        vm.prank(seller);
        vault.fund(address(bondToken), BOND_AMOUNT);

        assertEq(bondToken.balanceOf(address(vault)), BOND_AMOUNT * 2);
    }

    function test_RevertFundZeroAmount() public {
        _verifyViaReport(seller);
        vm.prank(seller);
        vm.expectRevert("SSL: zero amount");
        vault.fund(address(bondToken), 0);
    }

    function test_RevertFundNotVerified() public {
        vm.prank(seller);
        bondToken.approve(address(vault), BOND_AMOUNT);

        vm.prank(seller);
        vm.expectRevert("SSL: address not verified");
        vault.fund(address(bondToken), BOND_AMOUNT);
    }

    // ── Settlement via onReport ──

    function test_SettleViaReport() public {
        _setupFundedVault();

        bytes32 orderId = keccak256("order_1");
        _settleViaReport(orderId, BOND_AMOUNT, USDC_AMOUNT);

        // Stealth addresses received tokens
        assertEq(bondToken.balanceOf(stealthBuyer), BOND_AMOUNT);
        assertEq(usdc.balanceOf(stealthSeller), USDC_AMOUNT);
        assertTrue(vault.settledOrders(orderId));
    }

    function test_SettleEmitsEvent() public {
        _setupFundedVault();

        bytes32 orderId = keccak256("order_event");

        vm.expectEmit(true, true, false, true);
        emit ISSLVault.Settled(orderId, stealthBuyer, stealthSeller);

        _settleViaReport(orderId, BOND_AMOUNT, USDC_AMOUNT);
    }

    function test_RevertSettleNotForwarder() public {
        address attacker = makeAddr("attacker");
        bytes memory report = _encodeSettleReport(
            keccak256("x"),
            stealthBuyer,
            stealthSeller,
            address(bondToken),
            address(usdc),
            BOND_AMOUNT,
            USDC_AMOUNT
        );

        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                ReceiverTemplate.InvalidSender.selector,
                attacker,
                forwarder
            )
        );
        vault.onReport("", report);
    }

    function test_RevertSettleAlreadySettled() public {
        _setupFundedVault();

        bytes32 orderId = keccak256("order_dup");
        _settleViaReport(orderId, BOND_AMOUNT / 2, USDC_AMOUNT / 2);

        vm.prank(forwarder);
        vm.expectRevert("settled");
        vault.onReport(
            "",
            _encodeSettleReport(
                orderId,
                stealthBuyer,
                stealthSeller,
                address(bondToken),
                address(usdc),
                BOND_AMOUNT / 2,
                USDC_AMOUNT / 2
            )
        );
    }

    function test_RevertSettleInsufficientContractBalance() public {
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT / 2);

        bytes32 orderId = keccak256("fail_balance");
        bytes memory report = _encodeSettleReport(
            orderId,
            stealthBuyer,
            stealthSeller,
            address(bondToken),
            address(usdc),
            BOND_AMOUNT,
            0
        );

        vm.prank(forwarder);
        vm.expectRevert();
        vault.onReport("", report);
    }

    function test_RevertUnknownReportType() public {
        bytes memory report = abi.encode(uint8(99), uint256(0));
        vm.prank(forwarder);
        vm.expectRevert("SSL: unknown report type");
        vault.onReport("", report);
    }

    // ── Cross-Chain Settlement (type 3) ──

    function test_CrossChainSettleViaReport() public {
        bytes32 orderId = keccak256("cc_order_1");
        uint64 destChainSelector = 12345;
        address destVault = makeAddr("destVault");
        address recipient = makeAddr("recipient");

        // Fund vault with USDC to be bridged
        _fundAfterVerify(buyer, address(usdc), USDC_AMOUNT);

        bytes memory report = _encodeCrossChainSettleReport(
            orderId,
            destChainSelector,
            destVault,
            recipient,
            address(usdc),
            USDC_AMOUNT
        );

        vm.prank(forwarder);
        vault.onReport("", report);

        assertTrue(vault.settledOrders(orderId));
    }

    function test_CrossChainSettleEmitsEvent() public {
        bytes32 orderId = keccak256("cc_order_event");
        uint64 destChainSelector = 12345;
        address destVault = makeAddr("destVault");
        address recipient = makeAddr("recipient");
        bytes32 mockMsgId = ccipRouter.s_mockMessageId();

        _fundAfterVerify(buyer, address(usdc), USDC_AMOUNT);

        bytes memory report = _encodeCrossChainSettleReport(
            orderId,
            destChainSelector,
            destVault,
            recipient,
            address(usdc),
            USDC_AMOUNT
        );

        vm.expectEmit(true, false, false, true);
        emit ISSLVault.CrossChainSettled(orderId, destChainSelector, recipient, mockMsgId);

        vm.prank(forwarder);
        vault.onReport("", report);
    }

    function test_RevertCrossChainSettleAlreadySettled() public {
        bytes32 orderId = keccak256("cc_dup");
        uint64 destChainSelector = 12345;
        address destVault = makeAddr("destVault");
        address recipient = makeAddr("recipient");

        _fundAfterVerify(buyer, address(usdc), USDC_AMOUNT);

        bytes memory report = _encodeCrossChainSettleReport(
            orderId, destChainSelector, destVault, recipient, address(usdc), USDC_AMOUNT / 2
        );

        vm.prank(forwarder);
        vault.onReport("", report);

        vm.prank(forwarder);
        vm.expectRevert("SSL: settled");
        vault.onReport("", report);
    }

    function test_RevertCrossChainSettleInsufficientLink() public {
        // Set CCIP fee higher than vault's LINK balance
        ccipRouter.setFee(LINK_AMOUNT + 1);

        bytes32 orderId = keccak256("cc_no_link");
        bytes memory report = _encodeCrossChainSettleReport(
            orderId,
            12345,
            makeAddr("destVault"),
            makeAddr("recipient"),
            address(usdc),
            USDC_AMOUNT
        );

        vm.prank(forwarder);
        vm.expectRevert("SSL: insufficient LINK for CCIP fee");
        vault.onReport("", report);
    }

    // ── setCCIPReceiver ──

    function test_SetCCIPReceiver() public {
        address receiver = makeAddr("ccipReceiver");
        vault.setCCIPReceiver(receiver);
        assertEq(vault.ccipReceiver(), receiver);
    }

    function test_RevertSetCCIPReceiverNotOwner() public {
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert();
        vault.setCCIPReceiver(makeAddr("receiver"));
    }

    // ── markSettled ──

    function test_MarkSettledByCCIPReceiver() public {
        address receiver = makeAddr("ccipReceiver");
        vault.setCCIPReceiver(receiver);

        bytes32 orderId = keccak256("ccip_settled");
        vm.prank(receiver);
        vault.markSettled(orderId);

        assertTrue(vault.settledOrders(orderId));
    }

    function test_RevertMarkSettledNotCCIPReceiver() public {
        vault.setCCIPReceiver(makeAddr("ccipReceiver"));

        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert("SSL: only ccip receiver");
        vault.markSettled(keccak256("x"));
    }

    function test_RevertMarkSettledAlreadySettled() public {
        address receiver = makeAddr("ccipReceiver");
        vault.setCCIPReceiver(receiver);
        bytes32 orderId = keccak256("already_settled");

        vm.prank(receiver);
        vault.markSettled(orderId);

        vm.prank(receiver);
        vm.expectRevert("SSL: settled");
        vault.markSettled(orderId);
    }

    // ── withdrawFees ──

    function test_WithdrawFees() public {
        // Fund vault with bond tokens
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT);

        address treasury = makeAddr("treasury");
        vault.withdrawFees(address(bondToken), treasury);

        assertEq(bondToken.balanceOf(treasury), BOND_AMOUNT);
        assertEq(bondToken.balanceOf(address(vault)), 0);
    }

    function test_RevertWithdrawFeesNotOwner() public {
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT);

        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert();
        vault.withdrawFees(address(bondToken), attacker);
    }

    // ── supportsInterface ──

    function test_SupportsInterfaceReceiver() public view {
        assertTrue(vault.supportsInterface(type(IReceiver).interfaceId));
    }

    function test_SupportsInterfaceERC165() public view {
        assertTrue(vault.supportsInterface(type(IERC165).interfaceId));
    }

    function test_DoesNotSupportRandomInterface() public view {
        assertFalse(vault.supportsInterface(bytes4(0xdeadbeef)));
    }

    // ── Withdrawal Flow ──

    function test_RequestWithdrawal() public {
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT);

        vm.prank(seller);
        vm.expectEmit(true, false, false, true);
        emit ISSLVault.WithdrawalRequested(
            seller,
            BOND_AMOUNT,
            1,
            block.timestamp
        );

        vault.requestWithdrawal(address(bondToken), BOND_AMOUNT);

        uint256[] memory ids = vault.getWithdrawalRequests(seller);
        assertEq(ids.length, 1);
        assertEq(ids[0], 1);

        (address token, uint256 amount, bool claimed) = vault.withdrawalRequests(1);
        assertEq(token, address(bondToken));
        assertEq(amount, BOND_AMOUNT);
        assertEq(claimed, false);
    }

    function test_RevertRequestWithdrawalZeroAmount() public {
        vm.prank(seller);
        vm.expectRevert("SSL: zero amount");
        vault.requestWithdrawal(address(bondToken), 0);
    }

    function test_ClaimWithdrawal() public {
        // 1. Fund
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT);

        // 2. Request
        vm.prank(seller);
        vault.requestWithdrawal(address(bondToken), BOND_AMOUNT);
        uint256 wId = vault.withdrawalId();

        // 3. Claim via Report (Type 2)
        bytes memory report = abi.encode(uint8(2), seller, wId);

        vm.prank(forwarder);
        vm.expectEmit(true, false, false, true);
        emit ISSLVault.WithdrawalClaimed(seller, wId, block.timestamp);

        vault.onReport("", report);

        // Verify tokens returned to seller
        // Seller started with BOND_AMOUNT * 10, funded BOND_AMOUNT, claimed BOND_AMOUNT -> back to 10 * BOND_AMOUNT
        assertEq(bondToken.balanceOf(seller), BOND_AMOUNT * 10);

        // Verify claimed state
        (, , bool claimed) = vault.withdrawalRequests(wId);
        assertTrue(claimed);
    }

    function test_RevertClaimAlreadyClaimed() public {
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT);
        vm.prank(seller);
        vault.requestWithdrawal(address(bondToken), BOND_AMOUNT);
        uint256 wId = vault.withdrawalId();

        bytes memory report = abi.encode(uint8(2), seller, wId);

        vm.prank(forwarder);
        vault.onReport("", report);

        vm.prank(forwarder);
        vm.expectRevert("SSL: already claimed");
        vault.onReport("", report);
    }

    function test_RevertClaimInvalidId() public {
        bytes memory report = abi.encode(uint8(2), seller, uint256(999));
        vm.prank(forwarder);
        vm.expectRevert("SSL: invalid withdrawal ID");
        vault.onReport("", report);
    }

    function test_MultipleWithdrawalRequests() public {
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT * 3);

        vm.startPrank(seller);
        vault.requestWithdrawal(address(bondToken), BOND_AMOUNT);
        vault.requestWithdrawal(address(bondToken), BOND_AMOUNT);
        vault.requestWithdrawal(address(bondToken), BOND_AMOUNT);
        vm.stopPrank();

        uint256[] memory ids = vault.getWithdrawalRequests(seller);
        assertEq(ids.length, 3);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
        assertEq(ids[2], 3);
    }

    // ── Full flow ──

    function test_FullFlow() public {
        // 1. CRE verifies both users
        _verifyViaReport(seller);
        _verifyViaReport(buyer);

        assertTrue(vault.isVerified(seller));
        assertTrue(vault.isVerified(buyer));

        // 2. Users fund
        vm.prank(seller);
        bondToken.approve(address(vault), 5_000e18);
        vm.prank(seller);
        vault.fund(address(bondToken), 5_000e18);

        vm.prank(buyer);
        usdc.approve(address(vault), 502_500e6);
        vm.prank(buyer);
        vault.fund(address(usdc), 502_500e6);

        assertEq(bondToken.balanceOf(address(vault)), 5_000e18);
        assertEq(usdc.balanceOf(address(vault)), 502_500e6);

        // 3. CRE settles
        address s1Buyer = makeAddr("s1Buyer");
        address s1Seller = makeAddr("s1Seller");

        bytes memory report = _encodeSettleReport(
            keccak256("trade_1"),
            s1Buyer,
            s1Seller,
            address(bondToken),
            address(usdc),
            5_000e18,
            502_500e6
        );
        vm.prank(forwarder);
        vault.onReport("", report);

        // 4. Verify final state
        assertEq(bondToken.balanceOf(s1Buyer), 5_000e18);
        assertEq(usdc.balanceOf(s1Seller), 502_500e6);
        assertEq(bondToken.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }
}
