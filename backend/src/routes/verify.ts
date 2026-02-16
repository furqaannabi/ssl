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
import prisma from "../clients/prisma";
import { recoverMessageAddress } from "viem";
import { streamText } from 'hono/streaming'

const verify = new Hono();

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

// ── Step 1: Submit Proof & Get Challenge ──
verify.post("/", async (c) => {
    const body = await c.req.json<VerifyInitPayload>();

    const required = [
        "nullifier_hash",
        "proof",
        "merkle_root",
        "user_address",
        "credential_type",
        "verification_level"
    ] as const;

    for (const field of required) {
        if (!body[field]) {
            return c.json({ error: `Missing required field: ${field}` }, 400);
        }
    }

    // Store in DB as PENDING
    try {
        const request = await prisma.verificationRequest.create({
            data: {
                nullifierHash: body.nullifier_hash,
                merkleRoot: body.merkle_root,
                proof: body.proof,
                credentialType: body.credential_type,
                verificationLevel: body.verification_level,
                signal: body.signal,
                userAddress: body.user_address,
                status: "PENDING",
            },
        });

        // Return the Request ID as the message to sign (or a specific format)
        // Here we ask the user to sign the Request ID directly
        return c.json({
            success: true,
            requestId: request.id,
            messageToSign: request.id,
            status: "PENDING",
        });
    } catch (err) {
        console.error("[verify] DB create failed:", err);
        return c.json({ error: "Failed to create verification request", detail: String(err) }, 500);
    }
});

// ── Step 2: Confirm with Signature ──
verify.post("/:id/confirm", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<VerifyConfirmPayload>();

    if (!body.signature) {
        return c.json({ error: "Missing signature" }, 400);
    }

    try {
        // Fetch request
        const request = await prisma.verificationRequest.findUnique({
            where: { id },
        });

        if (!request) {
            return c.json({ error: "Verification request not found" }, 404);
        }

        if (request.status === "VERIFIED") {
            return c.json({ success: true, status: "VERIFIED", message: "Already verified" });
        }

        // Verify Signature
        // Recover address from signature of the message (requestId)
        const recoveredAddress = await recoverMessageAddress({
            message: request.id,
            signature: body.signature as `0x${string}`,
        });

        if (recoveredAddress.toLowerCase() !== request.userAddress.toLowerCase()) {
            return c.json({ error: "Invalid signature. Signer does not match userAddress." }, 401);
        }

        // ── Forward to CRE for Verification with SSE ──
        return streamText(c, async (stream) => {
            await stream.writeln(JSON.stringify({ type: 'log', message: 'Starting CRE verification...' }));

            try {
                const creResponse = await sendToCRE({
                    action: "verify",
                    nullifierHash: request.nullifierHash,
                    proof: request.proof,
                    merkle_root: request.merkleRoot,
                    credential_type: request.credentialType,
                    verification_level: request.verificationLevel,
                    signal: request.signal ?? "",
                    userAddress: request.userAddress,
                }, async (log) => {
                    await stream.writeln(JSON.stringify({ type: 'log', message: log }));
                });

                // Update DB status
                await prisma.verificationRequest.update({
                    where: { id },
                    data: { status: "VERIFIED" },
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
        console.error("[verify] Confirmation setup failed:", err);
        return c.json(
            {
                error: "Verification confirmation failed",
                detail: err instanceof Error ? err.message : String(err),
            },
            502
        );
    }
});
export { verify };
