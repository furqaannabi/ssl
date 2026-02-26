// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {PolicyEngine} from "@chainlink/policy-management/core/PolicyEngine.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVault {
    function register(address token, address policyEngine) external;
    function sRegistrars(address token) external view returns (address);
    function sPolicyEngines(address token) external view returns (address);
}

/// @title RegisterAllSSLTokens
/// @notice Registers all SSL ETH-Sepolia RWA tokens + USDC in the Convergence vault.
///
/// Each token gets its own PolicyEngine proxy (defaultAllow = true).
/// All proxies share one implementation to reduce gas.
/// Already-registered tokens are skipped automatically.
///
/// Run:
///   forge script script/RegisterAllSSLTokens.s.sol \
///     --rpc-url $RPC_URL \
///     --broadcast \
///     --private-key $PRIVATE_KEY
contract RegisterAllSSLTokens is Script {

    address constant VAULT = 0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13;

    // ── ETH Sepolia RWA tokens (from rwa-tokens.json) ────────────────────────
    address constant tMETA  = 0xFCC7984f670f67b30EBE357af9e57111206752d2;
    address constant tGOOGL = 0xFd9Cb05bBF89B73BC7E0e2e9e62bA0e857f99023;
    address constant tAAPL  = 0x802FFDc48bf2b3D29DD8337A571C69FEffbed025;
    address constant tTSLA  = 0xEc501fD82C92E6757136C7a90799b2F6FBe5A64c;
    address constant tAMZN  = 0x40064Da590b7E8E9D48DAd025860eF8c85C1577e;
    address constant tNVDA  = 0xC45D33597dC462506d179988314bb3154321399C;
    address constant tSPY   = 0x6dD00c4598dfAc984aC25671437A77170f96A57D;
    address constant tQQQ   = 0xC34f4bB995C2D185b0AA88a7caD7a56DEF4aaE57;
    address constant tBOND  = 0xeC07E587b64ef0E678CD7d747AA6bf2fB505C335;

    // ── USDC on ETH Sepolia (from addresses.json) ─────────────────────────────
    address constant USDC   = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;

    function _deployProxy(address impl, address owner) internal returns (address) {
        bytes memory initData = abi.encodeWithSelector(
            PolicyEngine.initialize.selector,
            true,   // defaultAllow = true
            owner
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
            "tMETA", "tGOOGL", "tAAPL", "tTSLA", "tAMZN", "tNVDA", "tSPY", "tQQQ", "tBOND", "USDC"
        ];

        IVault vault = IVault(VAULT);

        // Count how many tokens need registration
        uint256 toRegister = 0;
        for (uint256 i = 0; i < tokens.length; i++) {
            if (vault.sRegistrars(tokens[i]) == address(0)) toRegister++;
        }

        vm.startBroadcast(deployerPK);

        // Deploy ONE shared implementation (saves gas vs deploying 10 impls)
        PolicyEngine impl;
        if (toRegister > 0) {
            impl = new PolicyEngine();
            console.log("PolicyEngine impl:", address(impl));
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            address registrar = vault.sRegistrars(tokens[i]);

            if (registrar == address(0)) {
                // Deploy a fresh proxy for this token (each needs its own state)
                address proxy = _deployProxy(address(impl), deployer);
                vault.register(tokens[i], proxy);
                console.log("Registered :", names[i], tokens[i]);
                console.log("  PolicyEngine proxy:", proxy);

            } else if (registrar == deployer) {
                console.log("Already OK :", names[i], tokens[i]);
            } else {
                console.log("Skip (other registrar):", names[i]);
            }

            // Approve vault for max spend (idempotent — safe to repeat)
            // Skip if token address has no code (e.g. USDC may not be deployed on this network)
            if (tokens[i].code.length > 0) {
                try IERC20(tokens[i]).approve(VAULT, type(uint256).max) {} catch {
                    console.log("  approve() skipped (non-contract or reverted):", names[i]);
                }
            } else {
                console.log("  approve() skipped (no code at address):", names[i]);
            }
        }

        vm.stopBroadcast();

        console.log("");
        console.log("============================================");
        console.log("  REGISTRATION COMPLETE");
        console.log("============================================");
        console.log("Vault  :", VAULT);
        console.log("Tokens : 9 RWA + USDC processed");
        console.log("============================================");
    }
}
