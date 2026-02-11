// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/core/SSLVault.sol";
import "../src/core/ACEComplianceAdapter.sol";
import "../src/ccip/SSLCCIPSender.sol";
import "../src/ccip/SSLCCIPReceiver.sol";
import "../src/mocks/MockBondToken.sol";
import "../src/mocks/MockUSDC.sol";
import "../src/mocks/MockCCIPRouter.sol";
import "../src/interfaces/ISSLVault.sol";
import "../src/interfaces/IACEComplianceAdapter.sol";

/**
 * @title SSLVaultTest
 * @notice End-to-end test for the Stealth Settlement Layer
 * @dev Simulates the full dark pool flow:
 *      onboarding → deposit → order → match → compliance → settlement
 */
contract SSLVaultTest is Test {
    // ── Contracts ──
    SSLVault public vault;
    ACEComplianceAdapter public compliance;
    MockBondToken public bondToken;
    MockUSDC public usdc;
    MockCCIPRouter public ccipRouter;
    SSLCCIPSender public ccipSender;
    SSLCCIPReceiver public ccipReceiver;

    // ── Actors ──
    address public owner = address(this);
    address public operator = makeAddr("operator");
    address public institutionA = makeAddr("institutionA"); // Seller (has bonds)
    address public institutionB = makeAddr("institutionB"); // Buyer (has USDC)

    // ── Constants ──
    uint256 public constant BOND_AMOUNT = 10_000e18; // 10,000 bonds
    uint256 public constant USDC_AMOUNT = 1_005_000e6; // 1,005,000 USDC
    uint256 public constant TRADE_PRICE = 100_50; // $100.50 per bond (scaled)
    uint256 public constant MAX_TRADE_SIZE = 10_000_000e6; // $10M max

    // CCIP chain selector for Ethereum Sepolia
    uint64 public constant ETH_SEPOLIA_SELECTOR = 16015286601757825753;

    function setUp() public {
        // 1. Deploy compliance adapter
        compliance = new ACEComplianceAdapter();

        // 2. Deploy vault
        vault = new SSLVault(address(compliance), operator);

        // 3. Deploy mock tokens
        bondToken = new MockBondToken();
        usdc = new MockUSDC();

        // 4. Deploy CCIP stack
        ccipRouter = new MockCCIPRouter();
        ccipSender = new SSLCCIPSender(address(ccipRouter));
        ccipReceiver = new SSLCCIPReceiver(address(ccipRouter), address(vault));

        // 5. Register institutions as compliant
        compliance.registerInstitution(institutionA, "US", MAX_TRADE_SIZE);
        compliance.registerInstitution(institutionB, "UK", MAX_TRADE_SIZE);

        // 6. Mint tokens to institutions
        bondToken.mint(institutionA, BOND_AMOUNT);
        usdc.mint(institutionB, USDC_AMOUNT);

        // 7. Approve vault
        vm.prank(institutionA);
        bondToken.approve(address(vault), type(uint256).max);

        vm.prank(institutionB);
        usdc.approve(address(vault), type(uint256).max);
    }

    // ──────────────────────────────────────────────
    //  Compliance Tests
    // ──────────────────────────────────────────────

    function test_InstitutionRegistered() public {
        assertTrue(compliance.isCompliant(institutionA));
        assertTrue(compliance.isCompliant(institutionB));
        assertFalse(compliance.isCompliant(makeAddr("random")));
    }

    function test_ComplianceStatusUpdate() public {
        compliance.updateComplianceStatus(
            institutionA,
            IACEComplianceAdapter.ComplianceStatus.SUSPENDED
        );
        assertFalse(compliance.isCompliant(institutionA));
    }

    function test_TradeComplianceCheck() public {
        assertTrue(
            compliance.checkTradeCompliance(institutionA, institutionB, 1_000e6)
        );
        // Exceeds max trade size
        assertFalse(
            compliance.checkTradeCompliance(
                institutionA,
                institutionB,
                MAX_TRADE_SIZE + 1
            )
        );
    }

    // ──────────────────────────────────────────────
    //  Deposit & Withdraw Tests
    // ──────────────────────────────────────────────

    function test_Deposit() public {
        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);

        assertEq(
            vault.getBalance(institutionA, address(bondToken)),
            BOND_AMOUNT
        );
        assertEq(bondToken.balanceOf(address(vault)), BOND_AMOUNT);
    }

    function test_Withdraw() public {
        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);

        vm.prank(institutionA);
        vault.withdraw(address(bondToken), 5_000e18);

        assertEq(vault.getBalance(institutionA, address(bondToken)), 5_000e18);
    }

    function test_RevertWithdrawInsufficient() public {
        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);

        vm.prank(institutionA);
        vm.expectRevert("SSL: insufficient available balance");
        vault.withdraw(address(bondToken), BOND_AMOUNT + 1);
    }

    function test_RevertDepositNonCompliant() public {
        address random = makeAddr("random");
        bondToken.mint(random, 1_000e18);
        vm.prank(random);
        bondToken.approve(address(vault), type(uint256).max);

        vm.prank(random);
        vm.expectRevert("SSL: wallet not compliant");
        vault.deposit(address(bondToken), 1_000e18);
    }

    // ──────────────────────────────────────────────
    //  Order Tests
    // ──────────────────────────────────────────────

    function test_SubmitOrder() public {
        // Deposit first
        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);

        // Submit sell order
        vm.prank(institutionA);
        uint256 orderId = vault.submitOrder(
            address(bondToken),
            BOND_AMOUNT,
            TRADE_PRICE,
            ISSLVault.OrderSide.SELL,
            keccak256("encrypted_order_a")
        );

        assertEq(orderId, 1);
        ISSLVault.Order memory order = vault.getOrder(orderId);
        assertEq(order.trader, institutionA);
        assertEq(uint8(order.status), uint8(ISSLVault.OrderStatus.OPEN));
        assertEq(order.amount, BOND_AMOUNT);

        // Tokens are escrowed
        assertEq(
            vault.getEscrowedBalance(institutionA, address(bondToken)),
            BOND_AMOUNT
        );
        assertEq(
            vault.getAvailableBalance(institutionA, address(bondToken)),
            0
        );
    }

    function test_CancelOrder() public {
        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);

        vm.prank(institutionA);
        uint256 orderId = vault.submitOrder(
            address(bondToken),
            BOND_AMOUNT,
            TRADE_PRICE,
            ISSLVault.OrderSide.SELL,
            keccak256("encrypted_order")
        );

        vm.prank(institutionA);
        vault.cancelOrder(orderId);

        ISSLVault.Order memory order = vault.getOrder(orderId);
        assertEq(uint8(order.status), uint8(ISSLVault.OrderStatus.CANCELLED));
        assertEq(vault.getEscrowedBalance(institutionA, address(bondToken)), 0);
        assertEq(
            vault.getAvailableBalance(institutionA, address(bondToken)),
            BOND_AMOUNT
        );
    }

    function test_RevertCancelNotOwner() public {
        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);

        vm.prank(institutionA);
        uint256 orderId = vault.submitOrder(
            address(bondToken),
            BOND_AMOUNT,
            TRADE_PRICE,
            ISSLVault.OrderSide.SELL,
            keccak256("encrypted_order")
        );

        vm.prank(institutionB);
        vm.expectRevert("SSL: not order owner");
        vault.cancelOrder(orderId);
    }

    // ──────────────────────────────────────────────
    //  Settlement Tests (The Dark Pool Moment)
    // ──────────────────────────────────────────────

    function test_ExecuteSettlement() public {
        // ── Step 1: Deposits ──
        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);

        vm.prank(institutionB);
        vault.deposit(address(usdc), USDC_AMOUNT);

        // ── Step 2: Submit private orders ──
        vm.prank(institutionA);
        uint256 sellOrderId = vault.submitOrder(
            address(bondToken),
            BOND_AMOUNT,
            TRADE_PRICE,
            ISSLVault.OrderSide.SELL,
            keccak256("encrypted_sell_order")
        );

        vm.prank(institutionB);
        uint256 buyOrderId = vault.submitOrder(
            address(usdc),
            USDC_AMOUNT,
            TRADE_PRICE,
            ISSLVault.OrderSide.BUY,
            keccak256("encrypted_buy_order")
        );

        // ── Step 3: CRE operator executes settlement ──
        vm.prank(operator);
        uint256 settlementId = vault.executeSettlement(
            buyOrderId,
            sellOrderId,
            address(bondToken), // base token (bonds)
            address(usdc), // quote token (USDC)
            BOND_AMOUNT, // 10,000 bonds
            USDC_AMOUNT // 1,005,000 USDC
        );

        // ── Verify settlement ──
        assertEq(settlementId, 1);

        // Buyer now has bonds, Seller now has USDC
        assertEq(
            vault.getBalance(institutionB, address(bondToken)),
            BOND_AMOUNT
        );
        assertEq(vault.getBalance(institutionA, address(usdc)), USDC_AMOUNT);

        // Original balances are zero
        assertEq(vault.getBalance(institutionA, address(bondToken)), 0);
        assertEq(vault.getBalance(institutionB, address(usdc)), 0);

        // Orders are settled
        assertEq(
            uint8(vault.getOrder(sellOrderId).status),
            uint8(ISSLVault.OrderStatus.SETTLED)
        );
        assertEq(
            uint8(vault.getOrder(buyOrderId).status),
            uint8(ISSLVault.OrderStatus.SETTLED)
        );

        // Settlement record
        ISSLVault.Settlement memory s = vault.getSettlement(settlementId);
        assertEq(s.buyer, institutionB);
        assertEq(s.seller, institutionA);
        assertEq(s.baseAmount, BOND_AMOUNT);
        assertEq(s.quoteAmount, USDC_AMOUNT);
    }

    function test_RevertSettlementNotOperator() public {
        // Deposit & submit orders
        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);
        vm.prank(institutionB);
        vault.deposit(address(usdc), USDC_AMOUNT);

        vm.prank(institutionA);
        uint256 sellId = vault.submitOrder(
            address(bondToken),
            BOND_AMOUNT,
            TRADE_PRICE,
            ISSLVault.OrderSide.SELL,
            keccak256("sell")
        );
        vm.prank(institutionB);
        uint256 buyId = vault.submitOrder(
            address(usdc),
            USDC_AMOUNT,
            TRADE_PRICE,
            ISSLVault.OrderSide.BUY,
            keccak256("buy")
        );

        // Random user cannot settle
        vm.prank(makeAddr("attacker"));
        vm.expectRevert("SSL: not operator");
        vault.executeSettlement(
            buyId,
            sellId,
            address(bondToken),
            address(usdc),
            BOND_AMOUNT,
            USDC_AMOUNT
        );
    }

    function test_RevertSettlementNonCompliant() public {
        // Deposit & submit orders
        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);
        vm.prank(institutionB);
        vault.deposit(address(usdc), USDC_AMOUNT);

        vm.prank(institutionA);
        uint256 sellId = vault.submitOrder(
            address(bondToken),
            BOND_AMOUNT,
            TRADE_PRICE,
            ISSLVault.OrderSide.SELL,
            keccak256("sell")
        );
        vm.prank(institutionB);
        uint256 buyId = vault.submitOrder(
            address(usdc),
            USDC_AMOUNT,
            TRADE_PRICE,
            ISSLVault.OrderSide.BUY,
            keccak256("buy")
        );

        // Suspend institution A
        compliance.updateComplianceStatus(
            institutionA,
            IACEComplianceAdapter.ComplianceStatus.SUSPENDED
        );

        // Settlement should fail compliance
        vm.prank(operator);
        vm.expectRevert("SSL: compliance check failed");
        vault.executeSettlement(
            buyId,
            sellId,
            address(bondToken),
            address(usdc),
            BOND_AMOUNT,
            USDC_AMOUNT
        );
    }

    // ──────────────────────────────────────────────
    //  Cross-Chain Settlement Test
    // ──────────────────────────────────────────────

    function test_CrossChainSettlement() public {
        // Set vault operator to ccipReceiver so it can call executeCrossChainSettlement
        vault.setOperator(address(ccipReceiver));

        // Configure CCIP sender
        ccipSender.configureDestination(
            ETH_SEPOLIA_SELECTOR,
            address(ccipReceiver)
        );
        ccipReceiver.setAllowedSender(
            ETH_SEPOLIA_SELECTOR,
            address(ccipSender)
        );

        // Deposit tokens
        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);
        vm.prank(institutionB);
        vault.deposit(address(usdc), USDC_AMOUNT);

        // Send cross-chain settlement via CCIP
        ccipSender.sendSettlement{value: 0.01 ether}(
            ETH_SEPOLIA_SELECTOR,
            institutionB, // buyer
            institutionA, // seller
            address(bondToken),
            address(usdc),
            BOND_AMOUNT,
            USDC_AMOUNT
        );

        // Verify settlement happened
        assertEq(
            vault.getBalance(institutionB, address(bondToken)),
            BOND_AMOUNT
        );
        assertEq(vault.getBalance(institutionA, address(usdc)), USDC_AMOUNT);
        assertEq(vault.totalSettlements(), 1);
    }

    // ──────────────────────────────────────────────
    //  Full Dark Pool Scenario
    // ──────────────────────────────────────────────

    function test_FullDarkPoolScenario() public {
        // ═══════════════════════════════════════════
        // This test simulates the full demo scenario:
        //
        // 1. Two institutions onboard through ACE
        // 2. Both deposit assets into the dark pool
        // 3. Both submit encrypted orders
        // 4. CRE matches orders off-chain
        // 5. Compliance check passes
        // 6. Atomic settlement executes
        // 7. Only final state is visible on-chain
        // ═══════════════════════════════════════════

        // Step 1: Institutions are already registered in setUp()
        IACEComplianceAdapter.InstitutionInfo memory infoA = compliance
            .getInstitutionInfo(institutionA);
        assertEq(infoA.wallet, institutionA);
        assertEq(
            uint8(infoA.status),
            uint8(IACEComplianceAdapter.ComplianceStatus.COMPLIANT)
        );

        // Step 2: Deposit into dark pool
        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);
        vm.prank(institutionB);
        vault.deposit(address(usdc), USDC_AMOUNT);

        // Step 3: Submit private orders (hash only on-chain)
        bytes32 encryptedSellHash = keccak256(
            abi.encodePacked("SELL", institutionA, BOND_AMOUNT, TRADE_PRICE)
        );
        bytes32 encryptedBuyHash = keccak256(
            abi.encodePacked("BUY", institutionB, USDC_AMOUNT, TRADE_PRICE)
        );

        vm.prank(institutionA);
        uint256 sellId = vault.submitOrder(
            address(bondToken),
            BOND_AMOUNT,
            TRADE_PRICE,
            ISSLVault.OrderSide.SELL,
            encryptedSellHash
        );

        vm.prank(institutionB);
        uint256 buyId = vault.submitOrder(
            address(usdc),
            USDC_AMOUNT,
            TRADE_PRICE,
            ISSLVault.OrderSide.BUY,
            encryptedBuyHash
        );

        // Step 4 + 5 + 6: CRE matches + compliance + settlement
        vm.prank(operator);
        vault.executeSettlement(
            buyId,
            sellId,
            address(bondToken),
            address(usdc),
            BOND_AMOUNT,
            USDC_AMOUNT
        );

        // Step 7: Only final settlement visible — no order book leaked
        assertEq(
            vault.getBalance(institutionB, address(bondToken)),
            BOND_AMOUNT
        );
        assertEq(vault.getBalance(institutionA, address(usdc)), USDC_AMOUNT);
        assertEq(vault.totalSettlements(), 1);
        assertEq(vault.totalOrders(), 2);

        // Institutions can withdraw their settled tokens
        vm.prank(institutionB);
        vault.withdraw(address(bondToken), BOND_AMOUNT);
        assertEq(bondToken.balanceOf(institutionB), BOND_AMOUNT);

        vm.prank(institutionA);
        vault.withdraw(address(usdc), USDC_AMOUNT);
        assertEq(usdc.balanceOf(institutionA), USDC_AMOUNT);
    }
}
