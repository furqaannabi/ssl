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
        vault: "0x16bc806da2d3b4e96900ce2e466a66f3ab651114",
        usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        ccipRouter: "0xD3b06cEbF099CE7DA4AcCf578aaEBFDBd6e88a93",
        forwarder: "0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5",
        rpcUrl: "https://base-sepolia.infura.io/v3/",
        wsUrl: "wss://base-sepolia.infura.io/ws/v3/",
        blockExplorer: "https://sepolia.basescan.org"
    },
    "ethereum-testnet-sepolia-arbitrum-1": {
        name: "Arbitrum Sepolia",
        chainId: 421614,
        chainSelector: "ethereum-testnet-sepolia-arbitrum-1",
        ccipChainSelector: "3478487238524512106",
        vault: "0xee538232aef29d55fbcb256b89bf517e8386e636",
        usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
        ccipRouter: "0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165",
        forwarder: "0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5",
        rpcUrl: "https://arbitrum-sepolia.infura.io/v3/",
        wsUrl: "wss://arbitrum-sepolia.infura.io/ws/v3/",
        blockExplorer: "https://sepolia.arbiscan.io"
    },
    "ethereum-testnet-sepolia": {
        name: "Ethereum Sepolia",
        chainId: 11155111,
        chainSelector: "ethereum-testnet-sepolia",
        ccipChainSelector: "16015286601757825753",
        vault: "0xf68f3db7d381f6e8994445f8b6bcbe81e32820f2",
        usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
        ccipRouter: "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59",
        forwarder: "0x15fC6ae953E024d975e77382eEeC56A9101f9F88",
        rpcUrl: "https://sepolia.infura.io/v3/",
        wsUrl: "wss://sepolia.infura.io/ws/v3/",
        blockExplorer: "https://sepolia.etherscan.io"
    }
};

export const TOKEN_DECIMALS: Record<string, number> = {
    USDC: 6,
    BOND: 18,
    TBILL: 18
};

// Helper to get chain by ID
export const getChainById = (chainId: number) => Object.values(CHAINS).find(c => c.chainId === chainId);
