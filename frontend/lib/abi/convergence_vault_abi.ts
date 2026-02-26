/**
 * Minimal ABI for the Convergence private token vault on ETH Sepolia.
 * Contract: 0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13
 * Docs: https://convergence2026-token-api.cldev.cloud/docs
 */
export const CONVERGENCE_VAULT_ABI = [
    {
        inputs: [
            { internalType: "address", name: "token",  type: "address" },
            { internalType: "uint256", name: "amount", type: "uint256" },
        ],
        name: "deposit",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            { internalType: "address", name: "token",         type: "address" },
            { internalType: "address", name: "policyEngine",  type: "address" },
        ],
        name: "register",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [
            { internalType: "address", name: "token", type: "address" },
        ],
        name: "sRegistrars",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            { internalType: "address", name: "token", type: "address" },
        ],
        name: "sPolicyEngines",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

export const CONVERGENCE_VAULT_ADDRESS = "0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13" as const;
export const CONVERGENCE_CHAIN_ID = 11155111 as const; // ETH Sepolia
