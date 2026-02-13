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
}

verify.post("/", async (c) => {
    const body = await c.req.json<WorldIDProof>();

    if (!body.nullifier_hash || !body.proof || !body.merkle_root) {
        return c.json({ error: "Missing World ID proof fields" }, 400);
    }

    // ── Step 1: Verify proof with World ID cloud API ──
    const verifyRes = await fetch(
        `https://developer.worldcoin.org/api/v2/verify/${config.worldAppId}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                merkle_root: body.merkle_root,
                nullifier_hash: body.nullifier_hash,
                proof: body.proof,
                action: config.worldAction,
            }),
        }
    );

    if (!verifyRes.ok) {
        const err = await verifyRes.text().catch(() => "verification failed");
        console.error("[verify] World ID verification failed:", err);
        return c.json({ error: "World ID verification failed", detail: err }, 400);
    }

    const verifyResult = await verifyRes.json();
    console.log("[verify] World ID verified:", body.nullifier_hash);

    // ── Step 2: Forward to CRE ──
    try {
        const creResponse = await sendToCRE({
            action: "verify",
            nullifierHash: body.nullifier_hash,
        });

        return c.json({
            success: true,
            nullifierHash: body.nullifier_hash,
            worldId: verifyResult,
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
