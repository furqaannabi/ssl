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
    worldAction: process.env.WORLD_ACTION || "verify-human",

    /** All chain configs keyed by chain name */
    chains,

    /** Production-only: CRE gateway URL */
    creGatewayUrl: process.env.CRE_GATEWAY_URL || "https://01.gateway.zone-a.cre.chain.link",
    /** Production-only: 64-char hex workflow ID (no 0x prefix) */
    creWorkflowId: process.env.CRE_WORKFLOW_ID || "",
} as const;

/**
 * Get all chains that have a vault deployed (non-empty vault address).
 */
export function getActiveChains(): [string, ChainConfig][] {
    return Object.entries(chains).filter(([, c]) => c.vault && c.vault.length > 0);
}
