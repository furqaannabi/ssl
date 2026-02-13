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

    uint256 public constant NULLIFIER_SELLER = 100;
    uint256 public constant NULLIFIER_BUYER = 200;

    function setUp() public {
        bondToken = new MockBondToken();
        usdc = new MockUSDC();

        vault = new StealthSettlementVault(forwarder);

        // Mint tokens
        bondToken.mint(seller, BOND_AMOUNT);
        usdc.mint(buyer, USDC_AMOUNT);
    }

    // ── Helpers ──

    function _verifyViaReport(uint256 nullifier) internal {
        bytes memory report = abi.encode(uint8(0), nullifier);
        vm.prank(forwarder);
        vault.onReport("", report);
    }

    function _fundAfterVerify(
        address user,
        address token,
        uint256 amount,
        uint256 nullifier
    ) internal {
        _verifyViaReport(nullifier);
        vm.prank(user);
        IERC20(token).approve(address(vault), amount);
        vm.prank(user);
        vault.fund(token, amount, nullifier);
    }

    function _encodeSettleReport(
        bytes32 orderId,
        address _stealthBuyer,
        address _stealthSeller,
        uint256 _buyerNullifier,
        uint256 _sellerNullifier,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) internal pure returns (bytes memory) {
        return abi.encode(
            uint8(1), orderId, _stealthBuyer, _stealthSeller,
            _buyerNullifier, _sellerNullifier,
            tokenA, tokenB, amountA, amountB
        );
    }

    function _settleViaReport(
        bytes32 orderId,
        uint256 amountA,
        uint256 amountB
    ) internal {
        bytes memory report = _encodeSettleReport(
            orderId, stealthBuyer, stealthSeller,
            NULLIFIER_BUYER, NULLIFIER_SELLER,
            address(bondToken), address(usdc),
            amountA, amountB
        );
        vm.prank(forwarder);
        vault.onReport("", report);
    }

    function _setupFundedVault() internal {
        // Seller deposits bondToken, buyer deposits USDC
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT, NULLIFIER_SELLER);
        _fundAfterVerify(buyer, address(usdc), USDC_AMOUNT, NULLIFIER_BUYER);
    }

    // ── Verify via Report ──

    function test_VerifyViaReport() public {
        _verifyViaReport(NULLIFIER_SELLER);
        assertTrue(vault.isVerified(NULLIFIER_SELLER));
    }

    function test_VerifyEmitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit ISSLVault.Verified(NULLIFIER_SELLER);
        _verifyViaReport(NULLIFIER_SELLER);
    }

    function test_RevertVerifyAlreadyVerified() public {
        _verifyViaReport(NULLIFIER_SELLER);

        bytes memory report = abi.encode(uint8(0), NULLIFIER_SELLER);
        vm.prank(forwarder);
        vm.expectRevert("SSL: already verified");
        vault.onReport("", report);
    }

    // ── Fund + Nullifier Binding ──

    function test_FundBindsNullifierToWallet() public {
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT, NULLIFIER_SELLER);

        assertEq(vault.nullifierOwner(NULLIFIER_SELLER), seller);
        assertEq(vault.balances(NULLIFIER_SELLER, address(bondToken)), BOND_AMOUNT);
        assertEq(bondToken.balanceOf(address(vault)), BOND_AMOUNT);
    }

    function test_FundMultipleDeposits() public {
        _verifyViaReport(NULLIFIER_SELLER);

        // First deposit
        bondToken.mint(seller, BOND_AMOUNT);
        vm.prank(seller);
        bondToken.approve(address(vault), BOND_AMOUNT);
        vm.prank(seller);
        vault.fund(address(bondToken), BOND_AMOUNT, NULLIFIER_SELLER);

        // Second deposit (same nullifier, same wallet)
        bondToken.mint(seller, BOND_AMOUNT);
        vm.prank(seller);
        bondToken.approve(address(vault), BOND_AMOUNT);
        vm.prank(seller);
        vault.fund(address(bondToken), BOND_AMOUNT, NULLIFIER_SELLER);

        assertEq(vault.balances(NULLIFIER_SELLER, address(bondToken)), BOND_AMOUNT * 2);
    }

    function test_FundEmitsEvent() public {
        _verifyViaReport(NULLIFIER_SELLER);

        vm.prank(seller);
        bondToken.approve(address(vault), BOND_AMOUNT);

        vm.expectEmit(true, false, false, true);
        emit ISSLVault.Funded(address(bondToken), BOND_AMOUNT, NULLIFIER_SELLER);

        vm.prank(seller);
        vault.fund(address(bondToken), BOND_AMOUNT, NULLIFIER_SELLER);
    }

    function test_RevertFundZeroAmount() public {
        _verifyViaReport(NULLIFIER_SELLER);
        vm.prank(seller);
        vm.expectRevert("SSL: zero amount");
        vault.fund(address(bondToken), 0, NULLIFIER_SELLER);
    }

    function test_RevertFundNotVerified() public {
        vm.prank(seller);
        vm.expectRevert("SSL: not verified");
        vault.fund(address(bondToken), BOND_AMOUNT, NULLIFIER_SELLER);
    }

    function test_RevertFundWrongWallet() public {
        // Seller funds first, binding nullifier
        _fundAfterVerify(seller, address(bondToken), BOND_AMOUNT, NULLIFIER_SELLER);

        // Attacker tries to use same nullifier
        address attacker = makeAddr("attacker");
        bondToken.mint(attacker, BOND_AMOUNT);
        vm.prank(attacker);
        bondToken.approve(address(vault), BOND_AMOUNT);

        vm.prank(attacker);
        vm.expectRevert("SSL: not owner");
        vault.fund(address(bondToken), BOND_AMOUNT, NULLIFIER_SELLER);
    }

    // ── IReceiver / ERC165 ──

    function test_SupportsIReceiverInterface() public view {
        assertTrue(vault.supportsInterface(type(IReceiver).interfaceId));
    }

    function test_SupportsERC165Interface() public view {
        assertTrue(vault.supportsInterface(type(IERC165).interfaceId));
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

        // Balances deducted
        assertEq(vault.balances(NULLIFIER_SELLER, address(bondToken)), 0);
        assertEq(vault.balances(NULLIFIER_BUYER, address(usdc)), 0);
    }

    function test_SettleEmitsEvent() public {
        _setupFundedVault();

        bytes32 orderId = keccak256("order_event");

        vm.expectEmit(true, false, false, true);
        emit ISSLVault.Settled(orderId, stealthBuyer, stealthSeller);

        _settleViaReport(orderId, BOND_AMOUNT, USDC_AMOUNT);
    }

    function test_RevertSettleNotForwarder() public {
        address attacker = makeAddr("attacker");
        bytes memory report = _encodeSettleReport(
            keccak256("x"), stealthBuyer, stealthSeller,
            NULLIFIER_BUYER, NULLIFIER_SELLER,
            address(bondToken), address(usdc),
            BOND_AMOUNT, USDC_AMOUNT
        );

        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, attacker, forwarder)
        );
        vault.onReport("", report);
    }

    function test_RevertSettleAlreadySettled() public {
        _setupFundedVault();

        bytes32 orderId = keccak256("order_dup");
        _settleViaReport(orderId, BOND_AMOUNT / 2, USDC_AMOUNT / 2);

        vm.prank(forwarder);
        vm.expectRevert("settled");
        vault.onReport("", _encodeSettleReport(
            orderId, stealthBuyer, stealthSeller,
            NULLIFIER_BUYER, NULLIFIER_SELLER,
            address(bondToken), address(usdc),
            BOND_AMOUNT / 2, USDC_AMOUNT / 2
        ));
    }

    function test_RevertSettleSellerInsufficientBalance() public {
        _setupFundedVault();

        vm.prank(forwarder);
        vm.expectRevert("SSL: seller insufficient balance");
        vault.onReport("", _encodeSettleReport(
            keccak256("over"), stealthBuyer, stealthSeller,
            NULLIFIER_BUYER, NULLIFIER_SELLER,
            address(bondToken), address(usdc),
            BOND_AMOUNT + 1, USDC_AMOUNT
        ));
    }

    function test_RevertSettleBuyerInsufficientBalance() public {
        _setupFundedVault();

        vm.prank(forwarder);
        vm.expectRevert("SSL: buyer insufficient balance");
        vault.onReport("", _encodeSettleReport(
            keccak256("over_b"), stealthBuyer, stealthSeller,
            NULLIFIER_BUYER, NULLIFIER_SELLER,
            address(bondToken), address(usdc),
            BOND_AMOUNT, USDC_AMOUNT + 1
        ));
    }

    function test_PartialSettlement() public {
        _setupFundedVault();

        uint256 halfBond = BOND_AMOUNT / 2;
        uint256 halfUsdc = USDC_AMOUNT / 2;

        // First partial settle
        _settleViaReport(keccak256("partial_1"), halfBond, halfUsdc);

        assertEq(vault.balances(NULLIFIER_SELLER, address(bondToken)), BOND_AMOUNT - halfBond);
        assertEq(vault.balances(NULLIFIER_BUYER, address(usdc)), USDC_AMOUNT - halfUsdc);

        // Second partial settle with remaining
        _settleViaReport(keccak256("partial_2"), BOND_AMOUNT - halfBond, USDC_AMOUNT - halfUsdc);

        assertEq(vault.balances(NULLIFIER_SELLER, address(bondToken)), 0);
        assertEq(vault.balances(NULLIFIER_BUYER, address(usdc)), 0);
    }

    function test_RevertUnknownReportType() public {
        bytes memory report = abi.encode(uint8(99), uint256(0));
        vm.prank(forwarder);
        vm.expectRevert("SSL: unknown report type");
        vault.onReport("", report);
    }

    // ── Full flow ──

    function test_FullFlow() public {
        // 1. CRE verifies both users
        _verifyViaReport(NULLIFIER_SELLER);
        _verifyViaReport(NULLIFIER_BUYER);

        assertTrue(vault.isVerified(NULLIFIER_SELLER));
        assertTrue(vault.isVerified(NULLIFIER_BUYER));

        // 2. Users fund (binds nullifier to wallet)
        vm.prank(seller);
        bondToken.approve(address(vault), 5_000e18);
        vm.prank(seller);
        vault.fund(address(bondToken), 5_000e18, NULLIFIER_SELLER);

        vm.prank(buyer);
        usdc.approve(address(vault), 502_500e6);
        vm.prank(buyer);
        vault.fund(address(usdc), 502_500e6, NULLIFIER_BUYER);

        assertEq(vault.nullifierOwner(NULLIFIER_SELLER), seller);
        assertEq(vault.nullifierOwner(NULLIFIER_BUYER), buyer);
        assertEq(vault.balances(NULLIFIER_SELLER, address(bondToken)), 5_000e18);
        assertEq(vault.balances(NULLIFIER_BUYER, address(usdc)), 502_500e6);

        // 3. CRE settles (includes nullifiers for balance checks)
        address s1Buyer = makeAddr("s1Buyer");
        address s1Seller = makeAddr("s1Seller");

        bytes memory report = _encodeSettleReport(
            keccak256("trade_1"),
            s1Buyer, s1Seller,
            NULLIFIER_BUYER, NULLIFIER_SELLER,
            address(bondToken), address(usdc),
            5_000e18, 502_500e6
        );
        vm.prank(forwarder);
        vault.onReport("", report);

        // 4. Verify final state
        assertEq(bondToken.balanceOf(s1Buyer), 5_000e18);
        assertEq(usdc.balanceOf(s1Seller), 502_500e6);
        assertEq(vault.balances(NULLIFIER_SELLER, address(bondToken)), 0);
        assertEq(vault.balances(NULLIFIER_BUYER, address(usdc)), 0);
        assertEq(bondToken.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }
}
