
import { createPublicClient, http, defineChain } from "viem";
import { baseSepolia } from "viem/chains";
import { config } from "../lib/config";

// Minimal ABI for isVerified
const abi = [
    {
        inputs: [{ name: "", type: "address" }],
        name: "isVerified",
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

// Create Viem Client
// We use the Alchemy key from env if available, otherwise fall back to public RPC
const transport = process.env.ALCHEMY_API_KEY
    ? http(`https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`)
    : http();

const client = createPublicClient({
    chain: baseSepolia,
    transport,
});

// Primary chain vault address (Base Sepolia)
const vaultAddress = (config.chains.baseSepolia?.vault ?? "") as `0x${string}`;

export const contractService = {
    /**
     * Check if a user address is verified on the SSLVault contract.
     * @param address User's wallet address
     */
    async getIsVerified(address: string): Promise<boolean> {
        if (!vaultAddress) {
            console.warn("[ContractService] No vault address configured — skipping isVerified check");
            return false;
        }
        try {
            const isVerified = await client.readContract({
                address: vaultAddress,
                abi,
                functionName: "isVerified",
                args: [address as `0x${string}`],
            });
            return isVerified;
        } catch (error) {
            console.error("[ContractService] isVerified check failed:", error);
            return false;
        }
    },
};
