// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/mocks/MockRWAToken.sol";
import "../src/core/SSLVault.sol";
import "./Config.sol";

/**
 * @title DeployRWATokens
 * @notice Deploys all mock RWA tokens and batch-whitelists them on the vault in one call.
 *
 *   Usage:
 *     forge script script/DeployRWATokens.s.sol:DeployRWATokens --rpc-url baseSepolia --broadcast
 *
 *   Env vars:
 *     PRIVATE_KEY   - deployer private key (required, must be vault owner)
 *     VAULT_ADDRESS - deployed StealthSettlementVault address (required)
 *     MINT_TO       - address to mint initial supply to (optional, defaults to deployer)
 *     MINT_AMOUNT   - initial mint per token in whole units (optional, default 1000000)
 */
contract DeployRWATokens is Script {
    struct TokenConfig {
        string name;
        string symbol;
        uint8 decimals;
        uint8 tokenType; // 0=STOCK, 1=ETF, 2=BOND, 4=STABLE
    }

    function _getChainUsdc() internal view returns (address) {
        if (block.chainid == SSLChains.BASE_SEPOLIA_CHAIN_ID) return SSLChains.BASE_SEPOLIA_USDC;
        if (block.chainid == SSLChains.ARB_SEPOLIA_CHAIN_ID) return SSLChains.ARB_SEPOLIA_USDC;
        if (block.chainid == SSLChains.ETH_SEPOLIA_CHAIN_ID) return SSLChains.ETH_SEPOLIA_USDC;
        return address(0);
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address vaultAddress = vm.envAddress("VAULT_ADDRESS");
        address mintTo = vm.envOr("MINT_TO", deployer);
        uint256 mintAmount = vm.envOr("MINT_AMOUNT", uint256(1_000_000));

        StealthSettlementVault vault = StealthSettlementVault(vaultAddress);

        TokenConfig[9] memory tokenConfigs = [
            TokenConfig("SSL Tokenized Meta Platforms",   "tMETA",  18, 0),
            TokenConfig("SSL Tokenized Alphabet Inc.",    "tGOOGL", 18, 0),
            TokenConfig("SSL Tokenized Apple Inc.",       "tAAPL",  18, 0),
            TokenConfig("SSL Tokenized Tesla Inc.",       "tTSLA",  18, 0),
            TokenConfig("SSL Tokenized Amazon.com",       "tAMZN",  18, 0),
            TokenConfig("SSL Tokenized NVIDIA Corp",      "tNVDA",  18, 0),
            TokenConfig("SSL Tokenized S&P 500 ETF",      "tSPY",   18, 1),
            TokenConfig("SSL Tokenized Nasdaq 100 ETF",   "tQQQ",   18, 1),
            TokenConfig("SSL Tokenized US Treasury Bond", "tBOND",  18, 2)
        ];

        address usdc = vm.envOr("USDC_ADDRESS", _getChainUsdc());

        console.log("=== SSL RWA Token Deployment ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Vault:", vaultAddress);
        console.log("Mint to:", mintTo);
        console.log("Mint amount per token:", mintAmount);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // --- Deploy all RWA tokens ---
        // Use max-size array then trim to actual count of non-whitelisted tokens
        ISSLVault.TokenInput[] memory inputsBuf = new ISSLVault.TokenInput[](10);
        uint256 count = 0;

        for (uint256 i = 0; i < tokenConfigs.length; i++) {
            TokenConfig memory cfg = tokenConfigs[i];

            MockRWAToken token = new MockRWAToken(cfg.name, cfg.symbol, cfg.decimals);
            token.mint(mintTo, mintAmount * (10 ** uint256(cfg.decimals)));

            console.log(string.concat(
                cfg.symbol, ": ", vm.toString(address(token)),
                " (type=", vm.toString(cfg.tokenType), ")"
            ));

            // Only whitelist if not already registered
            if (!vault.whitelistedTokens(address(token))) {
                inputsBuf[count++] = ISSLVault.TokenInput({
                    token: address(token),
                    symbol: cfg.symbol,
                    name: cfg.name,
                    tokenType: cfg.tokenType
                });
            } else {
                console.log(string.concat("  (already whitelisted, skipping)"));
            }
        }

        // --- Append USDC if available and not already whitelisted ---
        if (usdc != address(0)) {
            console.log(string.concat("USDC: ", vm.toString(usdc), " (type=4)"));
            if (!vault.whitelistedTokens(usdc)) {
                inputsBuf[count++] = ISSLVault.TokenInput({
                    token: usdc,
                    symbol: "USDC",
                    name: "USD Coin",
                    tokenType: 4
                });
            } else {
                console.log("  (already whitelisted, skipping)");
            }
        }

        // --- Batch whitelist only new tokens ---
        if (count > 0) {
            ISSLVault.TokenInput[] memory inputs = new ISSLVault.TokenInput[](count);
            for (uint256 i = 0; i < count; i++) inputs[i] = inputsBuf[i];
            vault.whitelistToken(inputs);
        } else {
            console.log("All tokens already whitelisted - nothing to do." );
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== All RWA tokens deployed and whitelisted ===");
    }
}
