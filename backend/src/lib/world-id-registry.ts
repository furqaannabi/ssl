/**
 * WorldIDVerifierRegistry on-chain writer
 *
 * After a successful World ID proof verification the backend calls
 * `setVerified(userAddress, true)` on the deployed WorldIDVerifierRegistry
 * contract so that the WorldIDPolicy ACE rule allows that address to deposit
 * into the Convergence private vault.
 *
 * Contract: set WORLD_ID_REGISTRY env var to the deployed registry address.
 * Chain:    ETH Sepolia (chainId 11155111) — same as the Convergence vault.
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config } from "./config";

// Minimal ABI — only the functions we call from the backend
const REGISTRY_ABI = [
    {
        inputs: [
            { name: "account", type: "address" },
            { name: "verified", type: "bool" },
        ],
        name: "setVerified",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        inputs: [{ name: "", type: "address" }],
        name: "isVerified",
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

function getRegistryAddress(): `0x${string}` | null {
    const addr = process.env.WORLD_ID_REGISTRY;
    if (!addr) return null;
    return addr as `0x${string}`;
}

/**
 * Read `isVerified(userAddress)` from the on-chain WorldIDVerifierRegistry.
 * Falls back to `false` (with a warning) if WORLD_ID_REGISTRY is not configured.
 */
export async function checkWorldIDVerified(userAddress: string): Promise<boolean> {
    const registryAddress = getRegistryAddress();
    if (!registryAddress) {
        console.warn("[WorldIDRegistry] WORLD_ID_REGISTRY not set — cannot check on-chain isVerified");
        return false;
    }

    const rpcUrl = process.env.ETH_SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/demo";
    const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(rpcUrl),
    });

    const verified = await publicClient.readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: "isVerified",
        args: [userAddress as `0x${string}`],
    });

    return verified as boolean;
}

/**
 * Mark `userAddress` as World ID verified in the on-chain registry.
 * No-ops with a warning if WORLD_ID_REGISTRY is not configured.
 */
export async function markWorldIDVerified(userAddress: string): Promise<void> {
    const registryAddress = getRegistryAddress();
    if (!registryAddress) {
        console.warn("[WorldIDRegistry] WORLD_ID_REGISTRY not set — skipping on-chain setVerified");
        return;
    }

    const account = privateKeyToAccount(config.evmPrivateKey);

    const rpcUrl = process.env.ETH_SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/demo";

    const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(rpcUrl),
    });

    const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(rpcUrl),
    });

    const { request } = await publicClient.simulateContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: "setVerified",
        args: [userAddress as `0x${string}`, true],
        account,
    });

    const txHash = await walletClient.writeContract(request);
    console.log(`[WorldIDRegistry] setVerified(${userAddress}, true) tx: ${txHash}`);
}
