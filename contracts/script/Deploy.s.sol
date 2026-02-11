// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/core/SSLVault.sol";
import "../src/core/ACEComplianceAdapter.sol";
import "../src/ccip/SSLCCIPSender.sol";
import "../src/ccip/SSLCCIPReceiver.sol";
import "../src/mocks/MockBondToken.sol";
import "../src/mocks/MockUSDC.sol";
import "../src/mocks/MockCCIPRouter.sol";
import "../src/interfaces/IACEComplianceAdapter.sol";
import {ChainConfig} from "./ChainConfig.sol";

/**
 * @title DeploySSL
 * @notice Deployment script for the Stealth Settlement Layer
 * @dev Uses ChainConfig helper for chain selectors and router addresses.
 *
 *      Usage:
 *        forge script script/Deploy.s.sol:DeploySSL --rpc-url $RPC_URL --broadcast
 *
 *      Env vars:
 *        PRIVATE_KEY          - deployer private key
 *        CCIP_ROUTER          - CCIP router address (optional, uses ChainConfig or mock)
 *        OPERATOR             - CRE operator address (defaults to deployer)
 *        LOCAL_CHAIN_SELECTOR - CCIP selector for this chain (defaults to Sepolia)
 */
contract DeploySSL is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address operatorAddress = vm.envOr("OPERATOR", deployer);
        uint64 localSelector = uint64(
            vm.envOr(
                "LOCAL_CHAIN_SELECTOR",
                uint256(ChainConfig.ETHEREUM_SEPOLIA)
            )
        );

        // Resolve CCIP router: env var > ChainConfig lookup > mock
        address routerAddr = vm.envOr("CCIP_ROUTER", address(0));

        vm.startBroadcast(deployerPrivateKey);

        // ── 1. Deploy mock tokens ──
        MockBondToken bondToken = new MockBondToken();
        MockUSDC usdc = new MockUSDC();
        console.log("MockBondToken:", address(bondToken));
        console.log("MockUSDC:", address(usdc));

        // ── 2. Deploy ACE compliance adapter ──
        ACEComplianceAdapter compliance = new ACEComplianceAdapter();
        console.log("ACEComplianceAdapter:", address(compliance));

        // ── 3. Deploy vault ──
        SSLVault vault = new SSLVault(address(compliance), operatorAddress);
        console.log("SSLVault:", address(vault));

        // ── 4. Resolve CCIP router ──
        if (routerAddr == address(0)) {
            // Try ChainConfig lookup first
            try this.lookupRouter(localSelector) returns (address r) {
                routerAddr = r;
                console.log("CCIP Router (from ChainConfig):", routerAddr);
            } catch {
                // No known router — deploy mock for local testing
                MockCCIPRouter mockRouter = new MockCCIPRouter();
                routerAddr = address(mockRouter);
                console.log("MockCCIPRouter:", routerAddr);
            }
        } else {
            console.log("CCIP Router (from env):", routerAddr);
        }

        // ── 5. Deploy CCIP contracts ──
        SSLCCIPSender ccipSender = new SSLCCIPSender(routerAddr);
        SSLCCIPReceiver ccipReceiver = new SSLCCIPReceiver(
            routerAddr,
            address(vault)
        );
        console.log("SSLCCIPSender:", address(ccipSender));
        console.log("SSLCCIPReceiver:", address(ccipReceiver));

        // ── 6. Onboard deployer as demo institution (CCID) ──
        compliance.registerIdentity(
            deployer,
            keccak256("DEPLOYER_IDENTITY"),
            "US"
        );
        compliance.issueCredential(
            deployer,
            IACEComplianceAdapter.CredentialType.KYC,
            365 days
        );
        compliance.issueCredential(
            deployer,
            IACEComplianceAdapter.CredentialType.SANCTIONS_CLEAR,
            365 days
        );

        // ── 7. Mint demo tokens ──
        bondToken.mint(deployer, 1_000_000e18);
        usdc.mint(deployer, 100_000_000e6);

        vm.stopBroadcast();

        console.log("");
        console.log("=== SSL Deployment Complete ===");
        console.log("Deployer:", deployer);
        console.log("Operator:", operatorAddress);
    }

    /// @dev External helper so we can use try/catch with the library
    function lookupRouter(
        uint64 chainSelector
    ) external pure returns (address) {
        return ChainConfig.getRouter(chainSelector);
    }
}
