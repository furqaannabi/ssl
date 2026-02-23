
import { createPublicClient, http, type Chain } from "viem";
import { baseSepolia, arbitrumSepolia, sepolia } from "viem/chains";
import { getActiveChains, type ChainConfig } from "../lib/config";

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

// Map config chain names → viem chain objects
const VIEM_CHAINS: Record<string, Chain> = {
    baseSepolia,
    arbitrumSepolia,
    ethSepolia: sepolia,
};

function buildTransport(chainName: string, chainCfg: ChainConfig) {
    if (chainCfg.rpcUrl) return http(chainCfg.rpcUrl);
    if (process.env.INFURA_API_KEY) {
        const infuraMap: Record<string, string> = {
            baseSepolia: `https://base-sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
            arbitrumSepolia: `https://arbitrum-sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
            ethSepolia: `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
        };
        if (infuraMap[chainName]) return http(infuraMap[chainName]);
    }
    return http();
}

export const contractService = {
    /**
     * Check if a user address is verified on ALL active SSLVault contracts.
     * Returns true only when every chain returns true.
     * @param address User's wallet address
     */
    async getIsVerified(address: string): Promise<boolean> {
        const activeChains = getActiveChains();

        if (activeChains.length === 0) {
            console.warn("[ContractService] No active chains configured — skipping isVerified check");
            return false;
        }

        const results = await Promise.all(
            activeChains.map(async ([chainName, chainCfg]) => {
                const viemChain = VIEM_CHAINS[chainName];
                if (!viemChain) {
                    console.warn(`[ContractService] Unknown chain "${chainName}" — skipping`);
                    return false;
                }

                const client = createPublicClient({
                    chain: viemChain,
                    transport: buildTransport(chainName, chainCfg),
                });

                try {
                    const verified = await client.readContract({
                        address: chainCfg.vault as `0x${string}`,
                        abi,
                        functionName: "isVerified",
                        args: [address as `0x${string}`],
                    });
                    console.log(`[ContractService] isVerified on ${chainName}: ${verified}`);
                    return verified;
                } catch (error) {
                    console.error(`[ContractService] isVerified check failed on ${chainName}:`, error);
                    return false;
                }
            })
        );

        return results.every(Boolean);
    },
};
