
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import prisma from "../clients/prisma";
import { verifyMessage } from "viem";
import { SignJWT } from "jose";
import { randomBytes } from "crypto";

const auth = new Hono();
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-key");

// Helper for random nonce
function generateNonce(): string {
    return `Sign this message to login to SSL: ${randomBytes(16).toString("hex")}`;
}

// ── GET /nonce/:address ──
auth.get("/nonce/:address", async (c) => {
    const address = c.req.param("address");

    try {
        const nonce = generateNonce();

        // Upsert user to ensure they exist and set nonce
        const user = await prisma.user.upsert({
            where: { address },
            update: { nonce },
            create: {
                address,
                name: `User ${address.slice(0, 6)}`,
                nonce,
            },
        });

        return c.json({ nonce: user.nonce });
    } catch (err) {
        console.error("[Auth] Nonce generation failed:", err);
        return c.json({ error: "Failed to generate nonce" }, 500);
    }
});

interface LoginPayload {
    address: string;
    signature: string;
}

// ── POST /login ──
auth.post("/login", async (c) => {
    const body = await c.req.json<LoginPayload>();

    if (!body.address || !body.signature) {
        return c.json({ error: "Missing address or signature" }, 400);
    }

    try {
        const user = await prisma.user.findUnique({
            where: { address: body.address },
        });

        if (!user || !user.nonce) {
            return c.json({ error: "User or nonce not found. Request nonce first." }, 404);
        }

        // Verify Signature
        const valid = await verifyMessage({
            address: body.address as `0x${string}`,
            message: user.nonce,
            signature: body.signature as `0x${string}`,
        });

        if (!valid) {
            return c.json({ error: "Invalid signature" }, 401);
        }

        // Create Session
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 1); // 24 hours

        const session = await prisma.session.create({
            data: {
                userAddress: user.address,
                expiresAt,
            },
        });

        // Generate JWT
        const token = await new SignJWT({
            sid: session.id,
            sub: user.address,
        })
            .setProtectedHeader({ alg: "HS256" })
            .setIssuedAt()
            .setExpirationTime("24h")
            .sign(JWT_SECRET);

        // Rotate Nonce (Clear it)
        await prisma.user.update({
            where: { address: user.address },
            data: { nonce: null },
        });

        // Set HttpOnly Cookie
        setCookie(c, "token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production", // Secure in prod only
            sameSite: "Lax",
            path: "/",
            maxAge: 60 * 60 * 24, // 24 hours
        });

        return c.json({
            success: true,
            sessionId: session.id,
            user: {
                address: user.address,
                name: user.name
            }
        });

    } catch (err) {
        console.error("[Auth] Login failed:", err);
        return c.json({ error: "Login failed", detail: String(err) }, 500);
    }
});

export { auth };
