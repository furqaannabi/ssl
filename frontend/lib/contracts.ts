import { parseUnits, encodeFunctionData, type Address, type Hex } from 'viem';

// Constants (Placeholders - to be filled with actual deployment addresses)
export const VAULT_ADDRESS: Address = "0x8920C3A0C83526E69D8A9E32BD4F4f218A720C3A";
export const TOKENS = {
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
    PAXG: "0x45804880De22913dAFE09f4980848ECE6Eec956D" as Address,
    TBILL: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Address
};

export const TOKEN_DECIMALS: Record<string, number> = {
    USDC: 6,
    PAXG: 18,
    TBILL: 18
};

// ABI fragments
export const VAULT_ABI = [
    {
        name: 'fund',
        type: 'function',
        stateMutability: 'external',
        inputs: [
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'nullifierHash', type: 'uint256' }
        ],
        outputs: []
    },
    {
        name: 'isVerified',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'nullifierHash', type: 'uint256' }],
        outputs: [{ type: 'bool' }]
    },
    {
        name: 'nullifierOwner',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'nullifierHash', type: 'uint256' }],
        outputs: [{ type: 'address' }]
    },
    {
        name: 'balances',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'nullifierHash', type: 'uint256' },
            { name: 'token', type: 'address' }
        ],
        outputs: [{ type: 'uint256' }]
    }
] as const;

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
