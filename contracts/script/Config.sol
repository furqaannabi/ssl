// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SSLChains
 * @notice Pure helper library with known chain constants.
 *         Nothing is deployed -- the deploy script and off-chain code
 *         reference these so magic numbers live in one place.
 */
library SSLChains {
    // ── Base Sepolia ──
    uint64  constant BASE_SEPOLIA_CCIP_SELECTOR = 10344971235874465080;
    uint256 constant BASE_SEPOLIA_CHAIN_ID      = 84532;
    address constant BASE_SEPOLIA_CCIP_ROUTER   = 0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93;
    address constant BASE_SEPOLIA_FORWARDER     = 0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5;
    address constant BASE_SEPOLIA_USDC          = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // ── Arbitrum Sepolia ──
    uint64  constant ARB_SEPOLIA_CCIP_SELECTOR  = 3478487238524512106;
    uint256 constant ARB_SEPOLIA_CHAIN_ID       = 421614;
    address constant ARB_SEPOLIA_CCIP_ROUTER    = 0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165;
    address constant ARB_SEPOLIA_FORWARDER      = 0xD41263567DdfeAd91504199b8c6c87371e83ca5d;
    address constant ARB_SEPOLIA_USDC          = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;

    // ── Ethereum Sepolia ──
    uint64  constant ETH_SEPOLIA_CCIP_SELECTOR  = 16015286601757825753;
    uint256 constant ETH_SEPOLIA_CHAIN_ID       = 11155111;
    address constant ETH_SEPOLIA_CCIP_ROUTER    = 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59;
    address constant ETH_SEPOLIA_FORWARDER      = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;
    address constant ETH_SEPOLIA_USDC          = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    /**
     * @notice Resolve CCIP router for the current chain (block.chainid).
     *         Reverts if the chain is unknown.
     */
    function ccipRouter() internal view returns (address) {
        if (block.chainid == BASE_SEPOLIA_CHAIN_ID)  return BASE_SEPOLIA_CCIP_ROUTER;
        if (block.chainid == ARB_SEPOLIA_CHAIN_ID)   return ARB_SEPOLIA_CCIP_ROUTER;
        if (block.chainid == ETH_SEPOLIA_CHAIN_ID)   return ETH_SEPOLIA_CCIP_ROUTER;
        revert("SSLChains: unsupported chain");
    }

    /**
     * @notice Resolve forwarder for the current chain.
     */
    function forwarder() internal view returns (address) {
        if (block.chainid == BASE_SEPOLIA_CHAIN_ID)  return BASE_SEPOLIA_FORWARDER;
        if (block.chainid == ARB_SEPOLIA_CHAIN_ID)   return ARB_SEPOLIA_FORWARDER;
        revert("SSLChains: unsupported chain");
    }

    /**
     * @notice Resolve CCIP chain selector for the current chain.
     */
    function ccipSelector() internal view returns (uint64) {
        if (block.chainid == BASE_SEPOLIA_CHAIN_ID)  return BASE_SEPOLIA_CCIP_SELECTOR;
        if (block.chainid == ARB_SEPOLIA_CHAIN_ID)   return ARB_SEPOLIA_CCIP_SELECTOR;
        if (block.chainid == ETH_SEPOLIA_CHAIN_ID)   return ETH_SEPOLIA_CCIP_SELECTOR;
        revert("SSLChains: unsupported chain");
    }
}
