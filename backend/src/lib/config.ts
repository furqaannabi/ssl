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
    // creWorkflowId: required("CRE_WORKFLOW_ID"), // Removed - unused in spawn mode
    evmPrivateKey: required("EVM_PRIVATE_KEY") as `0x${string}`,
    worldAction: process.env.WORLD_ACTION || "verify-human",
    vaultAddress: contracts.vault,
} as const;
