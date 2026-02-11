// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/core/SSLVault.sol";
import "../src/core/ACEComplianceAdapter.sol";
import "../src/ccip/SSLCCIPSender.sol";
import "../src/ccip/SSLCCIPReceiver.sol";
import "../src/mocks/MockBondToken.sol";
import "../src/mocks/MockUSDC.sol";

/**
 * @title DeploySSL
 * @notice Deployment script for the Stealth Settlement Layer
 * @dev Deploys all contracts and configures them for demo use
 *
 *      Usage:
 *        forge script script/Deploy.s.sol:DeploySSL --rpc-url $RPC_URL --broadcast
 */
contract DeploySSL is Script {
    // CCIP chain selectors
    uint64 public constant ETH_SEPOLIA = 16015286601757825753;
    uint64 public constant BASE_SEPOLIA = 10344971235874465080;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address ccipRouterAddress = vm.envOr("CCIP_ROUTER", address(0));
        address operatorAddress = vm.envOr("OPERATOR", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // ── 1. Deploy mock tokens ──
        MockBondToken bondToken = new MockBondToken();
        MockUSDC usdc = new MockUSDC();

        console.log("MockBondToken:", address(bondToken));
        console.log("MockUSDC:", address(usdc));

        // ── 2. Deploy compliance adapter ──
        ACEComplianceAdapter compliance = new ACEComplianceAdapter();
        console.log("ACEComplianceAdapter:", address(compliance));

        // ── 3. Deploy vault ──
        SSLVault vault = new SSLVault(address(compliance), operatorAddress);
        console.log("SSLVault:", address(vault));

        // ── 4. Deploy CCIP contracts (if router provided) ──
        if (ccipRouterAddress != address(0)) {
            SSLCCIPSender ccipSender = new SSLCCIPSender(ccipRouterAddress);
            SSLCCIPReceiver ccipReceiver = new SSLCCIPReceiver(
                ccipRouterAddress,
                address(vault)
            );

            console.log("SSLCCIPSender:", address(ccipSender));
            console.log("SSLCCIPReceiver:", address(ccipReceiver));
        }

        // ── 5. Mint demo tokens ──
        bondToken.mint(deployer, 1_000_000e18); // 1M bonds
        usdc.mint(deployer, 100_000_000e6); // 100M USDC

        vm.stopBroadcast();

        console.log("");
        console.log("=== SSL Deployment Complete ===");
        console.log("Deployer:", deployer);
        console.log("Operator:", operatorAddress);
    }
}
