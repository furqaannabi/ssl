// ──────────────────────────────────────────────
// POST /api/verify
// ──────────────────────────────────────────────
// Receives a World ID proof from the frontend,
// verifies it against the World ID cloud API,
// then forwards {action: "verify", nullifierHash}
// to the CRE workflow.

import { Hono } from "hono";
import { config } from "../lib/config";
import { sendToCRE } from "../lib/cre-client";

const verify = new Hono();

interface WorldIDProof {
    merkle_root: string;
    nullifier_hash: string;
    proof: string;
    verification_level: string;
    credential_type: string;
    signal?: string;
}

verify.post("/", async (c) => {
    const body = await c.req.json<WorldIDProof>();

    if (!body.nullifier_hash || !body.proof || !body.merkle_root) {
        return c.json({ error: "Missing World ID proof fields" }, 400);
    }

    // ── Forward to CRE for Verification ──
    try {
        const creResponse = await sendToCRE({
            action: "verify",
            nullifierHash: body.nullifier_hash,
            proof: body.proof,
            merkle_root: body.merkle_root,
            credential_type: body.credential_type,
            signal: body.signal ?? "", // Signal might be optional in request but required by CRE
        });

        return c.json({
            success: true,
            cre: creResponse,
        });
    } catch (err) {
        console.error("[verify] CRE forward failed:", err);
        return c.json(
            {
                error: "CRE forward failed",
                detail: err instanceof Error ? err.message : String(err),
            },
            502
        );
    }
});

export { verify };
