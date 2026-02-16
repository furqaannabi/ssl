// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/core/SSLVault.sol";
import "../src/mocks/MockBondToken.sol";
import "../src/mocks/MockUSDC.sol";

/**
 * @title DeployScript
 * @notice Deploys the Stealth Settlement Layer
 *
 *      Usage:
 *        ./deploy.sh
 *
 *      Env vars:
 *        PRIVATE_KEY        - deployer private key
 *        FORWARDER_ADDRESS  - KeystoneForwarder or MockForwarder address
 */
contract DeployScript is Script {
    address constant MOCK_FORWARDER =
        0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address forwarder = vm.envOr("FORWARDER_ADDRESS", MOCK_FORWARDER);

        vm.startBroadcast(deployerPrivateKey);

        // 2. Deploy vault
        StealthSettlementVault vault = new StealthSettlementVault(forwarder);
        console.log("StealthSettlementVault:", address(vault));

        vm.stopBroadcast();

        console.log("");
        console.log("=== SSL Deployment Complete ===");
        console.log("Deployer:", deployer);
        console.log("Forwarder:", forwarder);
    }
}
