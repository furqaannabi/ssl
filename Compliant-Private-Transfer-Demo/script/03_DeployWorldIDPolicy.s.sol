// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {PolicyEngine} from "@chainlink/policy-management/core/PolicyEngine.sol";

import {Policy} from "@chainlink/policy-management/core/Policy.sol";
import {WorldIDVerifierRegistry} from "../src/WorldIDVerifierRegistry.sol";
import {WorldIDPolicy} from "../src/WorldIDPolicy.sol";

interface IVault {
    function sPolicyEngines(address token) external view returns (address);
}

/// @title DeployWorldIDPolicy
/// @notice Deploys the World ID compliance layer and wires it to every token's
///         PolicyEngine in the Convergence private vault.
///
/// What it does
/// ─────────────
///  1. Deploys a single WorldIDVerifierRegistry (owned by the deployer / backend wallet).
///  2. Deploys one WorldIDPolicy implementation contract (shared, proxy pattern).
///  3. For each of the 10 registered tokens it:
///       a. Reads the token's PolicyEngine proxy from the vault.
///       b. Deploys a fresh WorldIDPolicy ERC-1967 proxy bound to that PolicyEngine.
///       c. Calls policyEngine.addPolicy(vault, depositSelector, policyProxy, []).
///
/// Prerequisites
/// ─────────────
///  • All tokens must already be registered (RegisterAllSSLTokens.s.sol done).
///  • PRIVATE_KEY env var must be the same key used for registration (has POLICY_CONFIG_ADMIN_ROLE).
///
/// Run
/// ───
///   forge script script/03_DeployWorldIDPolicy.s.sol \
///     --rpc-url $RPC_URL \
///     --broadcast \
///     --private-key $PRIVATE_KEY
///
/// After deployment
/// ────────────────
///  Set WORLD_ID_REGISTRY env var in the backend to the printed registry address,
///  then deploy the updated backend so it calls registry.setVerified() after each
///  successful World ID verification.
contract DeployWorldIDPolicy is Script {

    // ── Convergence vault (ETH Sepolia) ───────────────────────────────────────
    address constant VAULT = 0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13;

    // selector for deposit(address,uint256)
    bytes4 constant DEPOSIT_SELECTOR = bytes4(keccak256("deposit(address,uint256)"));

    // CRE forwarder on ETH Sepolia (validates TEE attestations before calling onReport)
    address constant CRE_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;

    // ── ETH Sepolia RWA tokens ────────────────────────────────────────────────
    address constant tMETA  = 0xFCC7984f670f67b30EBE357af9e57111206752d2;
    address constant tGOOGL = 0xFd9Cb05bBF89B73BC7E0e2e9e62bA0e857f99023;
    address constant tAAPL  = 0x802FFDc48bf2b3D29DD8337A571C69FEffbed025;
    address constant tTSLA  = 0xEc501fD82C92E6757136C7a90799b2F6FBe5A64c;
    address constant tAMZN  = 0x40064Da590b7E8E9D48DAd025860eF8c85C1577e;
    address constant tNVDA  = 0xC45D33597dC462506d179988314bb3154321399C;
    address constant tSPY   = 0x6dD00c4598dfAc984aC25671437A77170f96A57D;
    address constant tQQQ   = 0xC34f4bB995C2D185b0AA88a7caD7a56DEF4aaE57;
    address constant tBOND  = 0xeC07E587b64ef0E678CD7d747AA6bf2fB505C335;
    address constant USDC   = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function _deployPolicyProxy(
        address impl,
        address policyEngine,
        address owner,
        address registry
    ) internal returns (address) {
        bytes memory initData = abi.encodeWithSelector(
            Policy.initialize.selector,
            policyEngine,
            owner,
            abi.encode(registry) // configParams → registry address
        );
        return address(new ERC1967Proxy(impl, initData));
    }

    function run() external {
        uint256 deployerPK = vm.envUint("PRIVATE_KEY");
        address deployer   = vm.addr(deployerPK);

        console.log("Deployer :", deployer);
        console.log("Vault    :", VAULT);

        address[10] memory tokens = [
            tMETA, tGOOGL, tAAPL, tTSLA, tAMZN, tNVDA, tSPY, tQQQ, tBOND, USDC
        ];
        string[10] memory names = [
            "tMETA","tGOOGL","tAAPL","tTSLA","tAMZN","tNVDA","tSPY","tQQQ","tBOND","USDC"
        ];

        IVault vault = IVault(VAULT);

        vm.startBroadcast(deployerPK);

        // ── 1. Deploy shared WorldIDVerifierRegistry ─────────────────────────
        WorldIDVerifierRegistry registry = new WorldIDVerifierRegistry(deployer, CRE_FORWARDER);
        console.log("WorldIDVerifierRegistry:", address(registry));

        // ── 2. Deploy one shared WorldIDPolicy implementation ─────────────────
        WorldIDPolicy policyImpl = new WorldIDPolicy();
        console.log("WorldIDPolicy impl      :", address(policyImpl));

        // ── 3. Wire a fresh policy proxy to every token's PolicyEngine ────────
        bytes32[] memory emptyParamNames = new bytes32[](0);

        for (uint256 i = 0; i < tokens.length; i++) {
            address pe = vault.sPolicyEngines(tokens[i]);
            if (pe == address(0)) {
                console.log("SKIP (no PolicyEngine) :", names[i]);
                continue;
            }

            // Deploy a proxy bound to this specific PolicyEngine
            address policyProxy = _deployPolicyProxy(
                address(policyImpl),
                pe,
                deployer,
                address(registry)
            );

            // Register the policy for the deposit() selector
            PolicyEngine(pe).addPolicy(
                VAULT,
                DEPOSIT_SELECTOR,
                policyProxy,
                emptyParamNames
            );

            console.log("Wired :", names[i]);
            console.log("  PolicyEngine :", pe);
            console.log("  PolicyProxy  :", policyProxy);
        }

        vm.stopBroadcast();

        console.log("");
        console.log("============================================");
        console.log("  WORLD ID POLICY DEPLOYMENT COMPLETE");
        console.log("============================================");
        console.log("Registry :", address(registry));
        console.log("============================================");
        console.log("ACTION REQUIRED:");
        console.log("  Set WORLD_ID_REGISTRY=", address(registry));
        console.log("  in backend/.env so the backend can call");
        console.log("  registry.setVerified(userAddress, true)");
        console.log("  after each successful World ID verification.");
        console.log("============================================");
    }
}
