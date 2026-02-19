// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../src/core/SSLVault.sol";
import "../src/core/SSLCCIPReceiver.sol";
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
        address defaultLink      = SSLChains.linkToken();

        address forwarder  = vm.envOr("FORWARDER_ADDRESS", defaultForwarder);
        address ccipRouter = vm.envOr("CCIP_ROUTER", defaultRouter);
        address link       = vm.envOr("LINK_TOKEN", defaultLink);

        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Forwarder:", forwarder);
        console.log("CCIP Router:", ccipRouter);
        console.log("LINK Token:", link);

        uint256 linkFund = vm.envOr("LINK_FUND", uint256(1 ether));

        vm.startBroadcast(deployerPrivateKey);

        StealthSettlementVault vault = new StealthSettlementVault(
            forwarder,
            ccipRouter,
            link
        );

        SSLCCIPReceiver receiver = new SSLCCIPReceiver(
            ccipRouter,
            address(vault)
        );

        vault.setCCIPReceiver(address(receiver));

        IERC20(link).transfer(address(vault), linkFund);

        vm.stopBroadcast();

        console.log("");
        console.log("=== SSL Deployment Complete ===");
        console.log("StealthSettlementVault:", address(vault));
        console.log("SSLCCIPReceiver:", address(receiver));
        console.log("LINK funded:", linkFund);
    }
}
