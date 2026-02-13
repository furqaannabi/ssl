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
    address public funder = makeAddr("funder");
    address public stealthBuyer = makeAddr("stealthBuyer");
    address public stealthSeller = makeAddr("stealthSeller");

    uint256 public constant BOND_AMOUNT = 10_000e18;
    uint256 public constant USDC_AMOUNT = 1_005_000e6;

    uint256 public constant NULLIFIER_1 = 100;
    uint256 public constant NULLIFIER_2 = 200;

    function setUp() public {
        bondToken = new MockBondToken();
        usdc = new MockUSDC();

        vault = new StealthSettlementVault(forwarder);

        // Mint tokens to funder
        bondToken.mint(funder, BOND_AMOUNT);
        usdc.mint(funder, USDC_AMOUNT);
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
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) internal pure returns (bytes memory) {
        return abi.encode(uint8(1), orderId, _stealthBuyer, _stealthSeller, tokenA, tokenB, amountA, amountB);
    }

    function _settleViaReport(
        bytes32 orderId,
        address _stealthBuyer,
        address _stealthSeller,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) internal {
        bytes memory report = _encodeSettleReport(
            orderId, _stealthBuyer, _stealthSeller, tokenA, tokenB, amountA, amountB
        );
        vm.prank(forwarder);
        vault.onReport("", report);
    }

    // ── Verify via Report ──

    function test_VerifyViaReport() public {
        _verifyViaReport(NULLIFIER_1);
        assertTrue(vault.isVerified(NULLIFIER_1));
    }

    function test_VerifyEmitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit ISSLVault.Verified(NULLIFIER_1);
        _verifyViaReport(NULLIFIER_1);
    }

    function test_RevertVerifyAlreadyVerified() public {
        _verifyViaReport(NULLIFIER_1);

        bytes memory report = abi.encode(uint8(0), NULLIFIER_1);
        vm.prank(forwarder);
        vm.expectRevert("SSL: already verified");
        vault.onReport("", report);
    }

    // ── Fund ──

    function test_FundAfterVerify() public {
        _fundAfterVerify(funder, address(bondToken), BOND_AMOUNT, NULLIFIER_1);
        assertEq(bondToken.balanceOf(address(vault)), BOND_AMOUNT);
    }

    function test_FundEmitsEvent() public {
        _verifyViaReport(NULLIFIER_1);

        vm.prank(funder);
        bondToken.approve(address(vault), BOND_AMOUNT);

        vm.expectEmit(true, false, false, true);
        emit ISSLVault.Funded(address(bondToken), BOND_AMOUNT, NULLIFIER_1);

        vm.prank(funder);
        vault.fund(address(bondToken), BOND_AMOUNT, NULLIFIER_1);
    }

    function test_RevertFundZeroAmount() public {
        _verifyViaReport(NULLIFIER_1);
        vm.prank(funder);
        vm.expectRevert("SSL: zero amount");
        vault.fund(address(bondToken), 0, NULLIFIER_1);
    }

    function test_RevertFundNotVerified() public {
        vm.prank(funder);
        vm.expectRevert("SSL: not verified");
        vault.fund(address(bondToken), BOND_AMOUNT, NULLIFIER_1);
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
        _fundAfterVerify(funder, address(bondToken), BOND_AMOUNT, NULLIFIER_1);

        usdc.mint(funder, USDC_AMOUNT);
        _fundAfterVerify(funder, address(usdc), USDC_AMOUNT, NULLIFIER_2);

        bytes32 orderId = keccak256("order_1");
        _settleViaReport(
            orderId, stealthBuyer, stealthSeller,
            address(bondToken), address(usdc),
            BOND_AMOUNT, USDC_AMOUNT
        );

        assertEq(bondToken.balanceOf(stealthSeller), BOND_AMOUNT);
        assertEq(usdc.balanceOf(stealthBuyer), USDC_AMOUNT);
        assertTrue(vault.settledOrders(orderId));
    }

    function test_SettleEmitsEvent() public {
        _fundAfterVerify(funder, address(bondToken), BOND_AMOUNT, NULLIFIER_1);
        usdc.mint(funder, USDC_AMOUNT);
        _fundAfterVerify(funder, address(usdc), USDC_AMOUNT, NULLIFIER_2);

        bytes32 orderId = keccak256("order_event");

        vm.expectEmit(true, false, false, true);
        emit ISSLVault.Settled(orderId, stealthBuyer, stealthSeller);

        _settleViaReport(
            orderId, stealthBuyer, stealthSeller,
            address(bondToken), address(usdc),
            BOND_AMOUNT, USDC_AMOUNT
        );
    }

    function test_RevertSettleNotForwarder() public {
        address attacker = makeAddr("attacker");
        bytes memory report = _encodeSettleReport(
            keccak256("x"), stealthBuyer, stealthSeller,
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
        _fundAfterVerify(funder, address(bondToken), BOND_AMOUNT, NULLIFIER_1);
        usdc.mint(funder, USDC_AMOUNT);
        _fundAfterVerify(funder, address(usdc), USDC_AMOUNT, NULLIFIER_2);

        bytes32 orderId = keccak256("order_dup");
        _settleViaReport(
            orderId, stealthBuyer, stealthSeller,
            address(bondToken), address(usdc),
            BOND_AMOUNT, USDC_AMOUNT
        );

        vm.prank(forwarder);
        vm.expectRevert("settled");
        vault.onReport("", _encodeSettleReport(
            orderId, stealthBuyer, stealthSeller,
            address(bondToken), address(usdc),
            BOND_AMOUNT, USDC_AMOUNT
        ));
    }

    function test_RevertUnknownReportType() public {
        bytes memory report = abi.encode(uint8(99), uint256(0));
        vm.prank(forwarder);
        vm.expectRevert("SSL: unknown report type");
        vault.onReport("", report);
    }

    // ── Full flow ──

    function test_FullFlow() public {
        address user1 = makeAddr("user1");
        address user2 = makeAddr("user2");

        bondToken.mint(user1, 5_000e18);
        usdc.mint(user2, 502_500e6);

        // CRE verifies both users via reports
        _verifyViaReport(NULLIFIER_1);
        _verifyViaReport(NULLIFIER_2);

        assertTrue(vault.isVerified(NULLIFIER_1));
        assertTrue(vault.isVerified(NULLIFIER_2));

        // Users fund after verification
        vm.prank(user1);
        bondToken.approve(address(vault), 5_000e18);
        vm.prank(user1);
        vault.fund(address(bondToken), 5_000e18, NULLIFIER_1);

        vm.prank(user2);
        usdc.approve(address(vault), 502_500e6);
        vm.prank(user2);
        vault.fund(address(usdc), 502_500e6, NULLIFIER_2);

        // CRE settles via forwarder
        _settleViaReport(
            keccak256("trade_1"),
            makeAddr("s1Buyer"),
            makeAddr("s1Seller"),
            address(bondToken),
            address(usdc),
            5_000e18,
            502_500e6
        );

        assertEq(bondToken.balanceOf(makeAddr("s1Seller")), 5_000e18);
        assertEq(usdc.balanceOf(makeAddr("s1Buyer")), 502_500e6);
        assertEq(bondToken.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }
}
