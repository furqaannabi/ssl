export interface ChainConfig {
    chainId: number;
    chainSelector: string; // CCIP Selector
    ccipChainSelector: string; // CCIP Numeric ID
    vault: string;
    usdc: string;
    ccipRouter: string;
    forwarder: string;
    rpcUrl: string;
    wsUrl: string;
    name: string;
    blockExplorer: string;
}

export const CHAINS: Record<string, ChainConfig> = {
    "ethereum-testnet-sepolia-base-1": {
        name: "Base Sepolia",
        chainId: 84532,
        chainSelector: "ethereum-testnet-sepolia-base-1",
        ccipChainSelector: "10344971235874465080",
        vault: "0xe774bdeb66738c6647df64166f7c5170a3b45324",
        usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        ccipRouter: "0xD3b06cEbF099CE7DA4AcCf578aaEBFDBd6e88a93",
        forwarder: "0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5",
        rpcUrl: "https://base-sepolia.g.alchemy.com/v2/",
        wsUrl: "wss://base-sepolia.g.alchemy.com/v2/",
        blockExplorer: "https://sepolia.basescan.org"
    },
    "ethereum-testnet-sepolia-arbitrum-1": {
        name: "Arbitrum Sepolia",
        chainId: 421614,
        chainSelector: "ethereum-testnet-sepolia-arbitrum-1",
        ccipChainSelector: "3478487238524512106",
        vault: "0x722cfb0e21acdd84408e9b2aefd117be7359bf81",
        usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
        ccipRouter: "0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165",
        forwarder: "0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5",
        rpcUrl: "https://arb-sepolia.g.alchemy.com/v2/",
        wsUrl: "wss://arb-sepolia.g.alchemy.com/v2/",
        blockExplorer: "https://sepolia.arbiscan.io"
    }
};

export const TOKEN_DECIMALS: Record<string, number> = {
    USDC: 6,
    BOND: 18,
    TBILL: 18
};

// Helper to get chain by ID
export const getChainById = (chainId: number) => Object.values(CHAINS).find(c => c.chainId === chainId);
