// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/core/SSLVault.sol";
import "../src/mocks/MockBondToken.sol";
import "../src/mocks/MockUSDC.sol";
import "../src/interfaces/ISSLVault.sol";
import "../src/interfaces/IReceiver.sol";

contract SSLVaultTest is Test {
    StealthSettlementVault public vault;
    MockBondToken public bondToken;
    MockUSDC public usdc;

    address public forwarder = makeAddr("forwarder");
    address public seller = makeAddr("seller");
    address public buyer = makeAddr("buyer");
    address public stealthBuyer = makeAddr("stealthBuyer");
    address public stealthSeller = makeAddr("stealthSeller");

    uint256 public constant BOND_AMOUNT = 10_000e18;
    uint256 public constant USDC_AMOUNT = 1_005_000e6;

    function setUp() public {
        bondToken = new MockBondToken();
        usdc = new MockUSDC();

        vault = new StealthSettlementVault(forwarder);

        // Mint tokens
        bondToken.mint(seller, BOND_AMOUNT * 10); // Mint extra for multiple tests
        usdc.mint(buyer, USDC_AMOUNT * 10);
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

        vm.expectEmit(true, true, false, true); // orderId is indexed
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
        // Re-submit same order ID
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

    // Note: Can't test "insufficient balance" on a per-user basis easily because the contract doesn't track it.
    // However, if the contract itself doesn't have enough tokens, the transfer will fail (revert).
    function test_RevertSettleInsufficientContractBalance() public {
        // Don't fund the vault fully
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT / 2); // Only half funded

        bytes32 orderId = keccak256("fail_balance");

        // Try to settle for full amount
        bytes memory report = _encodeSettleReport(
            orderId,
            stealthBuyer,
            stealthSeller,
            address(bondToken),
            address(usdc),
            BOND_AMOUNT, // Requested more than in vault
            0
        );

        vm.prank(forwarder);
        // ERC20 transfer failures usually revert with "ERC20: transfer amount exceeds balance" or similar,
        // depending on the SafeERC20/token implementation.
        // MockBondToken might just revert underflow or similar.
        // We expect *some* revert.
        vm.expectRevert();
        vault.onReport("", report);
    }

    function test_RevertUnknownReportType() public {
        bytes memory report = abi.encode(uint8(99), uint256(0));
        vm.prank(forwarder);
        vm.expectRevert("SSL: unknown report type");
        vault.onReport("", report);
    }

    // ── Withdrawal Flow ──

    function test_RequestWithdrawal() public {
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT);

        vm.prank(seller);
        vm.expectEmit(true, false, false, true);
        // Check event: WithdrawalRequested(user, amount, id, timestamp)
        // We can't easily predict the ID if other tests ran, but since this is a fresh test function in Forge (usually), it should be 1.
        // Let's just check the data we can.
        // address indexed user, uint256 amount, uint256 withdrawalId, uint256 timestamp
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

        (address token, uint256 amount, bool claimed) = vault
            .withdrawalRequests(1);
        assertEq(token, address(bondToken));
        assertEq(amount, BOND_AMOUNT);
        assertEq(claimed, false);
    }

    function test_ClaimWithdrawal() public {
        // 1. Fund
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT);

        // 2. Request
        vm.prank(seller);
        vault.requestWithdrawal(address(bondToken), BOND_AMOUNT);
        uint256 withdrawalId = vault.withdrawalId();

        // 3. Claim via Report (Type 2)
        // Report format: (uint8 type, address user, uint256 withdrawalId)
        bytes memory report = abi.encode(uint8(2), seller, withdrawalId);

        vm.prank(forwarder);
        vm.expectEmit(true, false, false, true);
        emit ISSLVault.WithdrawalClaimed(seller, withdrawalId, block.timestamp);

        vault.onReport("", report);

        // Verify tokens returned to seller
        // Seller started with mint(seller, BOND_AMOUNT * 10) in setUp
        // Then funded BOND_AMOUNT. Balance = 9 * BOND_AMOUNT
        // Claimed BOND_AMOUNT. Balance should be 10 * BOND_AMOUNT again.
        assertEq(bondToken.balanceOf(seller), BOND_AMOUNT * 10);

        // Verify claimed state
        (, , bool claimed) = vault.withdrawalRequests(withdrawalId);
        assertTrue(claimed);
    }

    function test_RevertClaimAlreadyClaimed() public {
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT);
        vm.prank(seller);
        vault.requestWithdrawal(address(bondToken), BOND_AMOUNT);
        uint256 withdrawalId = vault.withdrawalId();

        bytes memory report = abi.encode(uint8(2), seller, withdrawalId);

        vm.prank(forwarder);
        vault.onReport("", report);

        // Try again
        vm.prank(forwarder);
        vm.expectRevert("SSL: already claimed");
        vault.onReport("", report);
    }

    function test_RevertClaimInvalidId() public {
        bytes memory report = abi.encode(uint8(2), seller, uint256(999)); // ID doesn't exist
        vm.prank(forwarder);
        vm.expectRevert("SSL: invalid withdrawal ID");
        vault.onReport("", report);
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
        // Contract should be empty
        assertEq(bondToken.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }
}
