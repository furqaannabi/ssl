
import { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { jwtVerify } from "jose";
import prisma from "../clients/prisma";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "super-secret-key");

export async function authMiddleware(c: Context, next: Next) {
    let token = getCookie(c, "token");
    const authHeader = c.req.header("Authorization");

    if (!token && authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
    }

    if (!token) {
        return c.json({ error: "Unauthorized: Missing or invalid token" }, 401);
    }

    try {
        const { payload } = await jwtVerify(token, JWT_SECRET);

        const sessionId = payload.sid as string;
        const userAddress = payload.sub as string;

        if (!sessionId || !userAddress) {
            return c.json({ error: "Unauthorized: Invalid token payload" }, 401);
        }

        // Check if session exists and is active
        const session = await prisma.session.findUnique({
            where: { id: sessionId },
        });

        if (!session) {
            return c.json({ error: "Unauthorized: Session invalid or expired" }, 401);
        }

        if (session.expiresAt < new Date()) {
            // Optional: Clean up expired session
            await prisma.session.delete({ where: { id: sessionId } }).catch(() => { });
            return c.json({ error: "Unauthorized: Session expired" }, 401);
        }

        c.set("user", userAddress);
        c.set("sessionId", sessionId);

        await next();
    } catch (err) {
        console.error("[AuthMiddleware] Verification failed:", err);
        return c.json({ error: "Unauthorized: Token verification failed" }, 401);
    }
}
