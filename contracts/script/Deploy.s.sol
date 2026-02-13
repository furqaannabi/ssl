// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/core/SSLVault.sol";
import "../src/mocks/MockBondToken.sol";
import "../src/mocks/MockUSDC.sol";

/**
 * @title DeploySSL
 * @notice Deploys the Stealth Settlement Layer
 *
 *      Usage:
 *        forge script script/Deploy.s.sol:DeploySSL --rpc-url $RPC_URL --broadcast
 *
 *      Env vars:
 *        PRIVATE_KEY        - deployer private key
 *        FORWARDER_ADDRESS  - KeystoneForwarder or MockForwarder address
 */
contract DeploySSL is Script {
    address constant MOCK_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address forwarder = vm.envOr("FORWARDER_ADDRESS", MOCK_FORWARDER);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy mock tokens
        MockBondToken bondToken = new MockBondToken();
        MockUSDC usdc = new MockUSDC();
        console.log("MockBondToken:", address(bondToken));
        console.log("MockUSDC:", address(usdc));

        // 2. Deploy vault
        StealthSettlementVault vault = new StealthSettlementVault(forwarder);
        console.log("StealthSettlementVault:", address(vault));

        // 3. Mint demo tokens
        bondToken.mint(deployer, 1_000_000e18);
        usdc.mint(deployer, 100_000_000e6);

        vm.stopBroadcast();

        console.log("");
        console.log("=== SSL Deployment Complete ===");
        console.log("Deployer:", deployer);
        console.log("Forwarder:", forwarder);
    }
}
