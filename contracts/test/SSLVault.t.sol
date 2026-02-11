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
 *      CCID onboarding → credential issuance → deposit → order → match → compliance → settlement
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
    uint256 public constant TRADE_PRICE = 100_50; // $100.50 per bond
    uint256 public constant CREDENTIAL_VALIDITY = 365 days;

    // CCIP chain selector for Ethereum Sepolia
    uint64 public constant ETH_SEPOLIA_SELECTOR = 16015286601757825753;

    function setUp() public {
        // 1. Deploy compliance adapter (ACE)
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

        // 5. Onboard institutions through ACE (CCID pattern)
        _onboardInstitution(institutionA, keccak256("INST_A_IDENTITY"), "US");
        _onboardInstitution(institutionB, keccak256("INST_B_IDENTITY"), "UK");

        // 6. Mint tokens to institutions
        bondToken.mint(institutionA, BOND_AMOUNT);
        usdc.mint(institutionB, USDC_AMOUNT);

        // 7. Approve vault
        vm.prank(institutionA);
        bondToken.approve(address(vault), type(uint256).max);

        vm.prank(institutionB);
        usdc.approve(address(vault), type(uint256).max);
    }

    /// @dev Simulates the ACE onboarding flow: register CCID → issue credentials
    function _onboardInstitution(
        address wallet,
        bytes32 identityHash,
        string memory jurisdiction
    ) internal {
        // Step 1: Register CCID identity (identity hash only, no PII on-chain)
        compliance.registerIdentity(wallet, identityHash, jurisdiction);

        // Step 2: Issue required credentials (KYC + Sanctions clearance)
        compliance.issueCredential(
            wallet,
            IACEComplianceAdapter.CredentialType.KYC,
            CREDENTIAL_VALIDITY
        );
        compliance.issueCredential(
            wallet,
            IACEComplianceAdapter.CredentialType.SANCTIONS_CLEAR,
            CREDENTIAL_VALIDITY
        );
    }

    // ──────────────────────────────────────────────
    //  ACE Compliance Tests
    // ──────────────────────────────────────────────

    function test_IdentityRegistered() public {
        assertTrue(compliance.isCompliant(institutionA));
        assertTrue(compliance.isCompliant(institutionB));
        assertFalse(compliance.isCompliant(makeAddr("random")));
    }

    function test_CCIDRecord() public view {
        IACEComplianceAdapter.CCID memory ccid = compliance.getIdentity(
            institutionA
        );
        assertEq(ccid.wallet, institutionA);
        assertEq(ccid.identityHash, keccak256("INST_A_IDENTITY"));
        assertTrue(ccid.active);
    }

    function test_CredentialValidation() public view {
        assertTrue(
            compliance.hasValidCredential(
                institutionA,
                IACEComplianceAdapter.CredentialType.KYC
            )
        );
        assertTrue(
            compliance.hasValidCredential(
                institutionA,
                IACEComplianceAdapter.CredentialType.SANCTIONS_CLEAR
            )
        );
        // No accreditation credential issued
        assertFalse(
            compliance.hasValidCredential(
                institutionA,
                IACEComplianceAdapter.CredentialType.ACCREDITATION
            )
        );
    }

    function test_CredentialExpiry() public {
        // Fast-forward past credential validity
        vm.warp(block.timestamp + CREDENTIAL_VALIDITY + 1);
        assertFalse(compliance.isCompliant(institutionA));
    }

    function test_CredentialRevocation() public {
        compliance.revokeCredential(
            institutionA,
            IACEComplianceAdapter.CredentialType.KYC
        );
        assertFalse(compliance.isCompliant(institutionA));
    }

    function test_DenylistBlocks() public {
        compliance.addToDenylist(institutionA);
        assertFalse(
            compliance.checkTradeCompliance(institutionA, institutionB, 1_000e6)
        );
    }

    function test_TradeComplianceCheck() public {
        assertTrue(
            compliance.checkTradeCompliance(institutionA, institutionB, 1_000e6)
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
        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);

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
        assertEq(
            vault.getEscrowedBalance(institutionA, address(bondToken)),
            BOND_AMOUNT
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

        assertEq(
            uint8(vault.getOrder(orderId).status),
            uint8(ISSLVault.OrderStatus.CANCELLED)
        );
        assertEq(vault.getEscrowedBalance(institutionA, address(bondToken)), 0);
    }

    // ──────────────────────────────────────────────
    //  Settlement Tests (The Dark Pool Moment)
    // ──────────────────────────────────────────────

    function test_ExecuteSettlement() public {
        // ── Deposits ──
        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);
        vm.prank(institutionB);
        vault.deposit(address(usdc), USDC_AMOUNT);

        // ── Submit private orders ──
        vm.prank(institutionA);
        uint256 sellOrderId = vault.submitOrder(
            address(bondToken),
            BOND_AMOUNT,
            TRADE_PRICE,
            ISSLVault.OrderSide.SELL,
            keccak256("encrypted_sell")
        );

        vm.prank(institutionB);
        uint256 buyOrderId = vault.submitOrder(
            address(usdc),
            USDC_AMOUNT,
            TRADE_PRICE,
            ISSLVault.OrderSide.BUY,
            keccak256("encrypted_buy")
        );

        // ── CRE operator executes settlement ──
        vm.prank(operator);
        uint256 settlementId = vault.executeSettlement(
            buyOrderId,
            sellOrderId,
            address(bondToken),
            address(usdc),
            BOND_AMOUNT,
            USDC_AMOUNT
        );

        // ── Verify ──
        assertEq(settlementId, 1);
        assertEq(
            vault.getBalance(institutionB, address(bondToken)),
            BOND_AMOUNT
        );
        assertEq(vault.getBalance(institutionA, address(usdc)), USDC_AMOUNT);
        assertEq(vault.getBalance(institutionA, address(bondToken)), 0);
        assertEq(vault.getBalance(institutionB, address(usdc)), 0);
    }

    function test_RevertSettlementNotOperator() public {
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

    function test_RevertSettlementRevokedCredential() public {
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

        // Revoke KYC credential for institution A
        compliance.revokeCredential(
            institutionA,
            IACEComplianceAdapter.CredentialType.KYC
        );

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
    //  Cross-Chain Settlement Test (CCIP)
    // ──────────────────────────────────────────────

    function test_CrossChainSettlement() public {
        vault.setOperator(address(ccipReceiver));

        ccipSender.configureDestination(
            ETH_SEPOLIA_SELECTOR,
            address(ccipReceiver)
        );
        ccipReceiver.setAllowedSender(
            ETH_SEPOLIA_SELECTOR,
            address(ccipSender)
        );

        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);
        vm.prank(institutionB);
        vault.deposit(address(usdc), USDC_AMOUNT);

        ccipSender.sendSettlement{value: 0.01 ether}(
            ETH_SEPOLIA_SELECTOR,
            institutionB,
            institutionA,
            address(bondToken),
            address(usdc),
            BOND_AMOUNT,
            USDC_AMOUNT
        );

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
        // Full demo: CCID onboarding → deposit → encrypted orders →
        //            confidential matching → ACE compliance → atomic settlement
        // ═══════════════════════════════════════════

        // Step 1: Verify CCID identities were registered
        IACEComplianceAdapter.CCID memory ccidA = compliance.getIdentity(
            institutionA
        );
        assertTrue(ccidA.active);
        assertEq(keccak256(bytes(ccidA.jurisdiction)), keccak256(bytes("US")));

        // Step 2: Deposit into dark pool
        vm.prank(institutionA);
        vault.deposit(address(bondToken), BOND_AMOUNT);
        vm.prank(institutionB);
        vault.deposit(address(usdc), USDC_AMOUNT);

        // Step 3: Submit private orders (only hash on-chain)
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

        // Step 4 + 5 + 6: CRE matches + ACE compliance + settlement
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

        // Withdraw settled tokens
        vm.prank(institutionB);
        vault.withdraw(address(bondToken), BOND_AMOUNT);
        assertEq(bondToken.balanceOf(institutionB), BOND_AMOUNT);

        vm.prank(institutionA);
        vault.withdraw(address(usdc), USDC_AMOUNT);
        assertEq(usdc.balanceOf(institutionA), USDC_AMOUNT);
    }
}
