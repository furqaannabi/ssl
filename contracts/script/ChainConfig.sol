// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ChainConfig
 * @notice Helper library with CCIP chain selectors and deployment constants
 * @dev Used by Deploy.s.sol to configure cross-chain routing.
 *      Not deployed on-chain — just compile-time constants.
 */
library ChainConfig {
    // ──────────────────────────────────────────────
    //  CCIP Chain Selectors
    // ──────────────────────────────────────────────

    uint64 internal constant ETHEREUM_SEPOLIA = 16015286601757825753;
    uint64 internal constant BASE_SEPOLIA = 10344971235874465080;
    uint64 internal constant AVALANCHE_FUJI = 14767482510784806043;
    uint64 internal constant ARBITRUM_SEPOLIA = 3478487238524512106;
    uint64 internal constant POLYGON_AMOY = 16281711391670634445;

    // ──────────────────────────────────────────────
    //  CCIP Router Addresses (Testnets)
    // ──────────────────────────────────────────────

    address internal constant SEPOLIA_ROUTER =
        0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59;
    address internal constant BASE_SEPOLIA_ROUTER =
        0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93;
    address internal constant ARBITRUM_SEPOLIA_ROUTER =
        0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165;

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    struct NetworkConfig {
        uint64 chainSelector;
        address ccipRouter;
        string name;
    }

    // ──────────────────────────────────────────────
    //  Helpers
    // ──────────────────────────────────────────────

    function getSepoliaConfig() internal pure returns (NetworkConfig memory) {
        return
            NetworkConfig({
                chainSelector: ETHEREUM_SEPOLIA,
                ccipRouter: SEPOLIA_ROUTER,
                name: "Ethereum Sepolia"
            });
    }

    function getBaseSepoliaConfig()
        internal
        pure
        returns (NetworkConfig memory)
    {
        return
            NetworkConfig({
                chainSelector: BASE_SEPOLIA,
                ccipRouter: BASE_SEPOLIA_ROUTER,
                name: "Base Sepolia"
            });
    }

    function getArbitrumSepoliaConfig()
        internal
        pure
        returns (NetworkConfig memory)
    {
        return
            NetworkConfig({
                chainSelector: ARBITRUM_SEPOLIA,
                ccipRouter: ARBITRUM_SEPOLIA_ROUTER,
                name: "Arbitrum Sepolia"
            });
    }

    /// @notice Get router address for a given chain selector
    function getRouter(uint64 chainSelector) internal pure returns (address) {
        if (chainSelector == ETHEREUM_SEPOLIA) return SEPOLIA_ROUTER;
        if (chainSelector == BASE_SEPOLIA) return BASE_SEPOLIA_ROUTER;
        if (chainSelector == ARBITRUM_SEPOLIA) return ARBITRUM_SEPOLIA_ROUTER;
        revert("ChainConfig: unknown chain");
    }
}
