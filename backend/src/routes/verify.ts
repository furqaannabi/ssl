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
import { streamText } from 'hono/streaming'
import { authMiddleware } from "../middleware/auth";
import prisma from "../clients/prisma";


type Variables = {
    user: string;
    sessionId: string;
}

const verify = new Hono<{ Variables: Variables }>();

interface VerifyInitPayload {
    merkle_root: string;
    nullifier_hash: string;
    proof: string;
    verification_level: string;
    credential_type: string;
    signal?: string;
    user_address: string; // New field
}

interface VerifyConfirmPayload {
    signature: string;
}

// ── Merged Verify Step: Submit Proof & Stream Verification ──
verify.post("/", authMiddleware, async (c) => {
    const body = await c.req.json<VerifyInitPayload>();
    const userAddress = c.get("user") as string;

    const required = [
        "nullifier_hash",
        "proof",
        "merkle_root",
        "user_address", // Still required in body for consistency, but we check against auth
        "credential_type",
        "verification_level"
    ] as const;

    for (const field of required) {
        if (!body[field]) {
            return c.json({ error: `Missing required field: ${field}` }, 400);
        }
    }

    // Ensure ownership
    if (body.user_address.toLowerCase() !== userAddress.toLowerCase()) {
        return c.json({ error: "Unauthorized: You do not make this request" }, 403);
    }

    try {
        // ── Step 1: Verify proof with World ID API (v2) ──
        const worldIdUrl = `https://developer.worldcoin.org/api/v2/verify/${config.worldIdAppId}`;
        const worldIdRes = await fetch(worldIdUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                nullifier_hash: body.nullifier_hash,
                merkle_root: body.merkle_root,
                proof: body.proof,
                verification_level: body.verification_level,
                action: config.worldIdAction,
            }),
        });

        if (!worldIdRes.ok) {
            const errBody = await worldIdRes.json().catch(() => ({})) as any;
            const alreadyUsed = worldIdRes.status === 500 && errBody?.code === "max_verifications_reached";
            if (!alreadyUsed) {
                console.error("[verify] World ID rejected proof:", worldIdRes.status, errBody);
                return c.json({ error: "World ID verification failed", detail: errBody }, 400);
            }
            console.log("[verify] Nullifier already used — treating as verified");
        }

        // ── Step 2: Forward to CRE for on-chain settlement (World ID already confirmed) ──
        return streamText(c, async (stream) => {
            await stream.writeln(JSON.stringify({ type: 'log', message: 'World ID verified. Broadcasting on-chain...' }));

            try {
                const creResponse = await sendToCRE({
                    action: "verify",
                    nullifierHash: body.nullifier_hash,
                    proof: body.proof,
                    merkle_root: body.merkle_root,
                    credential_type: body.credential_type,
                    verification_level: body.verification_level,
                    signal: body.signal ?? "",
                    userAddress: body.user_address,
                    preVerified: true,
                }, async (log) => {
                    await stream.writeln(JSON.stringify({ type: 'log', message: log }));
                });

                // Update User status
                await prisma.user.update({
                    where: { address: userAddress },
                    data: { isVerified: true },
                });

                await stream.writeln(JSON.stringify({
                    type: 'result',
                    success: true,
                    status: "VERIFIED",
                    cre: creResponse,
                }));
            } catch (err) {
                console.error("[verify] CRE failed:", err);
                await stream.writeln(JSON.stringify({
                    type: 'error',
                    error: "Verification failed",
                    detail: err instanceof Error ? err.message : String(err),
                }));
            }
        });

    } catch (err) {
        console.error("[verify] Process failed:", err);
        return c.json({ error: "Failed to process verification", detail: String(err) }, 500);
    }
});

export { verify };
