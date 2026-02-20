import { parseUnits, encodeFunctionData, type Address, type Hex } from 'viem';
import { VAULT_ABI } from './abi/valut_abi';

import { CHAINS } from './chain-config';

// Constants (Placeholders - to be filled with actual deployment addresses)
export const TOKENS = {
    // Default to Base Sepolia for legacy support
    "usdc": CHAINS["ethereum-testnet-sepolia-base-1"].usdc,
    "bond": "0xa328fe09fd9f42c4cf95785b00876ba0bc82847a", // Bond is only on Base
}

export const CONTRACTS = {
    "vault": CHAINS["ethereum-testnet-sepolia-base-1"].vault,
}

export const getContracts = (chainId: number) => {
    const chain = Object.values(CHAINS).find(c => c.chainId === chainId);
    if (!chain) return null;
    return {
        vault: chain.vault,
        usdc: chain.usdc,
        // bond is only on base
        bond: chain.chainId === 84532 ? "0xa328fe09fd9f42c4cf95785b00876ba0bc82847a" : undefined
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
