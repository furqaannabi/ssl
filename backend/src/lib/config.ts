// ──────────────────────────────────────────────
// Typed environment config
// ──────────────────────────────────────────────
import contracts from "../../contracts.json";

function required(name: string): string {
    const val = process.env[name];
    if (!val) throw new Error(`Missing required env var: ${name}`);
    return val;
}

export const config = {
    port: Number(process.env.PORT || 3001),
    nodeEnv: process.env.NODE_ENV || "development",
    evmPrivateKey: required("EVM_PRIVATE_KEY") as `0x${string}`,
    worldAction: process.env.WORLD_ACTION || "verify-human",
    vaultAddress: contracts.vault,
    usdcAddress: contracts.usdc,
    /** Production-only: CRE gateway URL */
    creGatewayUrl: process.env.CRE_GATEWAY_URL || "https://01.gateway.zone-a.cre.chain.link",
    /** Production-only: 64-char hex workflow ID (no 0x prefix) */
    creWorkflowId: process.env.CRE_WORKFLOW_ID || "",
} as const;
