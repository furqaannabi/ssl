import { parseUnits, encodeFunctionData, type Address, type Hex } from 'viem';
import { VAULT_ABI } from './abi/valut_abi';

import { CHAINS } from './chain-config';

// Known token addresses (legacy fallback — tokens are discovered dynamically by vault listener)
export const TOKENS: Record<string, string> = {
    "usdc": CHAINS["ethereum-testnet-sepolia"].usdc,
}

export const CONTRACTS = {
    "vault": CHAINS["ethereum-testnet-sepolia"].vault,
}

// Per-chain contract lookup
export const getContracts = (chainId: number) => {
    const chain = Object.values(CHAINS).find(c => c.chainId === chainId);
    if (!chain) return null;
    return {
        vault: chain.vault,
        usdc: chain.usdc,
    };
}

export const TOKEN_DECIMALS: Record<string, number> = {
    USDC: 6,
    mUSDC: 6,
    BOND: 18,
    TBILL: 18,
    tMETA: 18,
    tGOOGL: 18,
    tAAPL: 18,
    tTSLA: 18,
    tAMZN: 18,
    tNVDA: 18,
    tSPY: 18,
    tQQQ: 18,
    tBOND: 18,
};

// ETH Sepolia RWA token addresses (hardcoded fallback for FundingModal when DB is not seeded)
export const ETH_SEPOLIA_TOKENS: Array<{ address: string; symbol: string; name: string; decimals: number; chainSelector: string }> = [
    { address: '0xfcc7984f670f67b30ebe357af9e57111206752d2', symbol: 'tMETA',  name: 'Meta Platforms',   decimals: 18, chainSelector: 'ethereum-testnet-sepolia' },
    { address: '0xfd9cb05bbf89b73bc7e0e2e9e62ba0e857f99023', symbol: 'tGOOGL', name: 'Alphabet Inc.',    decimals: 18, chainSelector: 'ethereum-testnet-sepolia' },
    { address: '0x802ffdc48bf2b3d29dd8337a571c69feffbed025', symbol: 'tAAPL',  name: 'Apple Inc.',       decimals: 18, chainSelector: 'ethereum-testnet-sepolia' },
    { address: '0xec501fd82c92e6757136c7a90799b2f6fbe5a64c', symbol: 'tTSLA',  name: 'Tesla Inc.',       decimals: 18, chainSelector: 'ethereum-testnet-sepolia' },
    { address: '0x40064da590b7e8e9d48dad025860ef8c85c1577e', symbol: 'tAMZN',  name: 'Amazon.com',       decimals: 18, chainSelector: 'ethereum-testnet-sepolia' },
    { address: '0xc45d33597dc462506d179988314bb3154321399c', symbol: 'tNVDA',  name: 'NVIDIA Corp',      decimals: 18, chainSelector: 'ethereum-testnet-sepolia' },
    { address: '0x6dd00c4598dfac984ac25671437a77170f96a57d', symbol: 'tSPY',   name: 'S&P 500 ETF',     decimals: 18, chainSelector: 'ethereum-testnet-sepolia' },
    { address: '0xc34f4bb995c2d185b0aa88a7cad7a56def4aae57', symbol: 'tQQQ',   name: 'Nasdaq 100 ETF',  decimals: 18, chainSelector: 'ethereum-testnet-sepolia' },
    { address: '0xec07e587b64ef0e678cd7d747aa6bf2fb505c335', symbol: 'tBOND',  name: 'US Treasury Bond', decimals: 18, chainSelector: 'ethereum-testnet-sepolia' },
    { address: '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d', symbol: 'USDC',   name: 'USD Coin',         decimals: 6,  chainSelector: 'ethereum-testnet-sepolia' },
];

// RWA Token metadata for UI display
export const RWA_TOKENS: Record<string, { name: string; type: 'STOCK' | 'ETF' | 'BOND' | 'STABLE'; realSymbol: string }> = {
    tMETA: { name: 'Meta Platforms', type: 'STOCK', realSymbol: 'META' },
    tGOOGL: { name: 'Alphabet Inc.', type: 'STOCK', realSymbol: 'GOOGL' },
    tAAPL: { name: 'Apple Inc.', type: 'STOCK', realSymbol: 'AAPL' },
    tTSLA: { name: 'Tesla Inc.', type: 'STOCK', realSymbol: 'TSLA' },
    tAMZN: { name: 'Amazon.com', type: 'STOCK', realSymbol: 'AMZN' },
    tNVDA: { name: 'NVIDIA Corp', type: 'STOCK', realSymbol: 'NVDA' },
    tSPY: { name: 'S&P 500 ETF', type: 'ETF', realSymbol: 'SPY' },
    tQQQ: { name: 'Nasdaq 100 ETF', type: 'ETF', realSymbol: 'QQQ' },
    tBOND: { name: 'US Treasury Bond', type: 'BOND', realSymbol: 'TLT' },
    BOND: { name: 'SSL Tokenized Bond', type: 'BOND', realSymbol: 'TLT' },
    USDC: { name: 'USD Coin', type: 'STABLE', realSymbol: 'USDC' },
    mUSDC: { name: 'Mock USDC', type: 'STABLE', realSymbol: 'USDC' },
};

// ABI fragments

export const ERC20_ABI = [
    {
        name: 'approve',
        type: 'function',
        stateMutability: 'external',
        inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' }
        ],
        outputs: [{ type: 'bool' }]
    },
    {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' }
        ],
        outputs: [{ type: 'uint256' }]
    }
] as const;

/**
 * Encodes the 'fund' function call for the SSLVault.
 */
export function encodeFundData(token: Address, amount: string, decimals: number, nullifierHash: string): Hex {
    const amountUnits = parseUnits(amount, decimals);
    return encodeFunctionData({
        abi: VAULT_ABI,
        functionName: 'fund',
        args: [token, amountUnits, BigInt(nullifierHash)]
    });
}

/**
 * Encodes the 'approve' function call for an ERC20 token.
 */
export function encodeApproveData(spender: Address, amount: string, decimals: number): Hex {
    const amountUnits = parseUnits(amount, decimals);
    return encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender, amountUnits]
    });
}
