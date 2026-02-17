import { parseUnits, encodeFunctionData, type Address, type Hex } from 'viem';
import { VAULT_ABI } from './abi/valut_abi';

// Constants (Placeholders - to be filled with actual deployment addresses)
// Constants (Placeholders - to be filled with actual deployment addresses)
export const TOKENS = {
   
    "usdc": "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
}

export const CONTRACTS = {
    "vault": "0x987190756d7d9914be98c46fcabb863230ed3267",
    "bond": "0xa328fe09fd9f42c4cf95785b00876ba0bc82847a",
}

export const TOKEN_DECIMALS: Record<string, number> = {
    USDC: 6,
    PAXG: 18,
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
