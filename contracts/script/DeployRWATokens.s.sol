// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/mocks/MockRWAToken.sol";
import "../src/core/SSLVault.sol";

/**
 * @title DeployRWATokens
 * @notice Deploys all mock RWA tokens and whitelists them on the vault.
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
        uint8 tokenType; // 0=STOCK, 1=ETF, 2=BOND
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address vaultAddress = vm.envAddress("VAULT_ADDRESS");
        address mintTo = vm.envOr("MINT_TO", deployer);
        uint256 mintAmount = vm.envOr("MINT_AMOUNT", uint256(1_000_000));

        StealthSettlementVault vault = StealthSettlementVault(vaultAddress);

        TokenConfig[9] memory tokenConfigs = [
            TokenConfig("SSL Tokenized Meta Platforms",  "tMETA",  18, 0),
            TokenConfig("SSL Tokenized Alphabet Inc.",   "tGOOGL", 18, 0),
            TokenConfig("SSL Tokenized Apple Inc.",      "tAAPL",  18, 0),
            TokenConfig("SSL Tokenized Tesla Inc.",      "tTSLA",  18, 0),
            TokenConfig("SSL Tokenized Amazon.com",      "tAMZN",  18, 0),
            TokenConfig("SSL Tokenized NVIDIA Corp",     "tNVDA",  18, 0),
            TokenConfig("SSL Tokenized S&P 500 ETF",     "tSPY",   18, 1),
            TokenConfig("SSL Tokenized Nasdaq 100 ETF",  "tQQQ",   18, 1),
            TokenConfig("SSL Tokenized US Treasury Bond", "tBOND", 18, 2)
        ];

        console.log("=== SSL RWA Token Deployment ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Vault:", vaultAddress);
        console.log("Mint to:", mintTo);
        console.log("Mint amount per token:", mintAmount);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        for (uint256 i = 0; i < tokenConfigs.length; i++) {
            TokenConfig memory cfg = tokenConfigs[i];

            // Deploy token
            MockRWAToken token = new MockRWAToken(
                cfg.name,
                cfg.symbol,
                cfg.decimals
            );

            // Mint initial supply
            uint256 mintUnits = mintAmount * (10 ** uint256(cfg.decimals));
            token.mint(mintTo, mintUnits);

            // Whitelist on vault
            vault.whitelistToken(
                address(token),
                cfg.symbol,
                cfg.name,
                cfg.tokenType
            );

            console.log(string.concat(
                cfg.symbol, ": ", vm.toString(address(token)),
                " (type=", vm.toString(cfg.tokenType), ")"
            ));
        }

        // Also whitelist existing USDC on the vault if not already whitelisted
        // This is safe to call — will revert if already whitelisted
        // Users should manually whitelist USDC after deployment if needed

        vm.stopBroadcast();

        console.log("");
        console.log("=== All RWA tokens deployed and whitelisted ===");
        console.log("Don't forget to whitelist USDC manually:");
        console.log("  vault.whitelistToken(USDC_ADDRESS, 'USDC', 'USD Coin', 4)");
    }
}
