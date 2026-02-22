// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/core/SSLVault.sol";
import "../src/interfaces/ISSLVault.sol";

/**
 * @title WhitelistTokens
 * @notice Whitelists already-deployed RWA tokens on an existing vault.
 *         Skips tokens that are already whitelisted.
 *
 *   Usage:
 *     forge script script/WhitelistTokens.s.sol:WhitelistTokens --rpc-url <chain> --broadcast
 *
 *   Env vars (all required):
 *     PRIVATE_KEY       - deployer private key (must be vault owner)
 *     VAULT_ADDRESS     - deployed StealthSettlementVault address
 *     TOKEN_ADDRESSES   - comma-separated token addresses
 *     TOKEN_SYMBOLS     - comma-separated token symbols
 *     TOKEN_NAMES       - comma-separated token names
 *     TOKEN_TYPES       - comma-separated token types (0=STOCK,1=ETF,2=BOND,4=STABLE)
 */
contract WhitelistTokens is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address vaultAddress = vm.envAddress("VAULT_ADDRESS");

        address[] memory addresses = vm.envAddress("TOKEN_ADDRESSES", ",");
        string[] memory symbols    = vm.envString("TOKEN_SYMBOLS", ",");
        string[] memory names      = vm.envString("TOKEN_NAMES", ",");
        uint256[] memory types     = vm.envUint("TOKEN_TYPES", ",");

        require(
            addresses.length == symbols.length &&
            symbols.length == names.length &&
            names.length == types.length,
            "WhitelistTokens: array length mismatch"
        );

        StealthSettlementVault vault = StealthSettlementVault(vaultAddress);

        console.log("=== SSL Token Whitelist ===");
        console.log("Chain ID:", block.chainid);
        console.log("Vault:", vaultAddress);
        console.log("Tokens to process:", addresses.length);
        console.log("");

        ISSLVault.TokenInput[] memory inputsBuf = new ISSLVault.TokenInput[](addresses.length);
        uint256 count = 0;

        for (uint256 i = 0; i < addresses.length; i++) {
            if (vault.whitelistedTokens(addresses[i])) {
                console.log(string.concat("  [skip] already whitelisted: ", symbols[i]));
            } else {
                inputsBuf[count++] = ISSLVault.TokenInput({
                    token: addresses[i],
                    symbol: symbols[i],
                    name: names[i],
                    tokenType: uint8(types[i])
                });
                console.log(string.concat("  [add]  ", symbols[i], " -> ", vm.toString(addresses[i])));
            }
        }

        if (count == 0) {
            console.log("All tokens already whitelisted - nothing to do.");
            return;
        }

        ISSLVault.TokenInput[] memory inputs = new ISSLVault.TokenInput[](count);
        for (uint256 i = 0; i < count; i++) inputs[i] = inputsBuf[i];

        vm.startBroadcast(deployerPrivateKey);
        vault.whitelistToken(inputs);
        vm.stopBroadcast();

        console.log("");
        console.log(string.concat("=== Whitelisted ", vm.toString(count), " token(s) ==="));
    }
}
