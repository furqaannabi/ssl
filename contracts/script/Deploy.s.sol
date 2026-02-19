// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/core/SSLVault.sol";
import "./Config.sol";

/**
 * @title DeployScript
 * @notice Deploys StealthSettlementVault to whatever chain the RPC points at.
 *         Uses SSLChains library defaults and allows env-var overrides.
 *
 *      Usage:
 *        forge script script/Deploy.s.sol:DeployScript --rpc-url <name> --broadcast
 *
 *      Env vars (all optional except PRIVATE_KEY):
 *        PRIVATE_KEY        - deployer private key  (required)
 *        FORWARDER_ADDRESS  - override forwarder
 *        CCIP_ROUTER        - override CCIP router
 */
contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Resolve defaults from SSLChains, allow env override
        address defaultForwarder = SSLChains.forwarder();
        address defaultRouter    = SSLChains.ccipRouter();

        address forwarder  = vm.envOr("FORWARDER_ADDRESS", defaultForwarder);
        address ccipRouter = vm.envOr("CCIP_ROUTER", defaultRouter);

        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Forwarder:", forwarder);
        console.log("CCIP Router:", ccipRouter);

        vm.startBroadcast(deployerPrivateKey);

        StealthSettlementVault vault = new StealthSettlementVault(
            forwarder,
            ccipRouter
        );

        vm.stopBroadcast();

        console.log("");
        console.log("=== SSL Deployment Complete ===");
        console.log("StealthSettlementVault:", address(vault));
    }
}
