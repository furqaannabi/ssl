// ──────────────────────────────────────────────
// Typed environment config
// ──────────────────────────────────────────────
import addresses from "../../addresses.json";

function required(name: string): string {
    const val = process.env[name];
    if (!val) throw new Error(`Missing required env var: ${name}`);
    return val;
}

export interface ChainConfig {
    chainId: number;
    chainSelector: string;
    ccipChainSelector: string;
    vault: string;
    ccipReceiver: string;
    usdc: string;
    link: string;
    ccipRouter: string;
    forwarder: string;
    rpcUrl: string;
    wsUrl: string;
}

const chains = (addresses as any).chains as Record<string, ChainConfig>;

export const config = {
    port: Number(process.env.PORT || 3001),
    nodeEnv: process.env.NODE_ENV || "development",
    evmPrivateKey: required("EVM_PRIVATE_KEY") as `0x${string}`,
    worldIdAppId: process.env.WORLD_ID_APP_ID || "app_staging_72f7715e459d7b53ec15c8bf7398fd0f",
    worldIdAction: process.env.WORLD_ID_ACTION || "atlasverification",

    /** All chain configs keyed by chain name */
    chains,

    /** Production-only: CRE gateway URL */
    creGatewayUrl: process.env.CRE_GATEWAY_URL || "https://01.gateway.zone-a.cre.chain.link",
    /** Production-only: 64-char hex workflow ID (no 0x prefix) */
    creWorkflowId: process.env.CRE_WORKFLOW_ID || "",

    /** Convergence private-token vault (ETH Sepolia) */
    convergenceApiUrl:      process.env.CONVERGENCE_API_URL      || "https://convergence2026-token-api.cldev.cloud",
    convergenceContract:    process.env.CONVERGENCE_CONTRACT      || "0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13",
    convergenceChainId:     Number(process.env.CONVERGENCE_CHAIN_ID || 11155111),

    /** CRE TEE matching workflow */
    creCallbackSecret: process.env.CRE_CALLBACK_SECRET || "cre-callback-secret-change-in-production",
    /** secp256k1 private key — public key published so frontend can encrypt orders for the TEE */
    creEncryptionKey:  (process.env.CRE_ENCRYPTION_KEY || process.env.EVM_PRIVATE_KEY || "") as `0x${string}`,
} as const;

/**
 * Get all chains that have a vault deployed (non-empty vault address).
 */
export function getActiveChains(): [string, ChainConfig][] {
    return Object.entries(chains).filter(([, c]) => c.vault && c.vault.length > 0);
}
