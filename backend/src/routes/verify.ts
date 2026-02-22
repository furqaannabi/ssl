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
        // ── Forward to CRE for Verification with SSE ──
        return streamText(c, async (stream) => {
            await stream.writeln(JSON.stringify({ type: 'log', message: 'Starting CRE verification...' }));

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
