// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/core/SSLVault.sol";
import "../src/mocks/MockBondToken.sol";
import "../src/mocks/MockUSDC.sol";

/**
 * @title DeploySSL
 * @notice Deployment script for the Stealth Settlement Layer
 * @dev Deploys the stealth settlement vault and mock tokens on a Tenderly Virtual TestNet.
 *      Identity verification is handled off-chain via World ID inside CRE.
 *
 *      Usage:
 *        forge script script/Deploy.s.sol:DeploySSL --rpc-url $RPC_URL --broadcast
 *
 *      Env vars:
 *        PRIVATE_KEY  - deployer private key
 *        CRE_SIGNER   - CRE signer address (defaults to deployer)
 */
contract DeploySSL is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address creSignerAddress = vm.envOr("CRE_SIGNER", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // ── 1. Deploy mock tokens ──
        MockBondToken bondToken = new MockBondToken();
        MockUSDC usdc = new MockUSDC();
        console.log("MockBondToken:", address(bondToken));
        console.log("MockUSDC:", address(usdc));

        // ── 2. Deploy stealth settlement vault ──
        StealthSettlementVault vault = new StealthSettlementVault(creSignerAddress);
        console.log("StealthSettlementVault:", address(vault));

        // ── 3. Mint demo tokens and fund vault ──
        bondToken.mint(deployer, 1_000_000e18);
        usdc.mint(deployer, 100_000_000e6);

        // Fund vault so it can execute settlements
        bondToken.approve(address(vault), 1_000_000e18);
        usdc.approve(address(vault), 100_000_000e6);
        vault.fund(address(bondToken), 1_000_000e18);
        vault.fund(address(usdc), 100_000_000e6);

        vm.stopBroadcast();

        console.log("");
        console.log("=== SSL Deployment Complete ===");
        console.log("Deployer:", deployer);
        console.log("CRE Signer:", creSignerAddress);
    }
}
