// ──────────────────────────────────────────────
// Typed environment config
// ──────────────────────────────────────────────

function required(name: string): string {
    const val = process.env[name];
    if (!val) throw new Error(`Missing required env var: ${name}`);
    return val;
}

export const config = {
    port: Number(process.env.PORT || 3001),
    creWorkflowUrl: required("CRE_WORKFLOW_URL"),
    evmPrivateKey: required("EVM_PRIVATE_KEY") as `0x${string}`,
    worldAppId: required("WORLD_APP_ID"),
    worldAction: process.env.WORLD_ACTION || "verify-human",
} as const;
