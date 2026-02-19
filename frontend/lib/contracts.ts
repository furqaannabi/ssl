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
    BOND: 18,
    TBILL: 18
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
