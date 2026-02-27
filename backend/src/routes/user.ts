
import { Hono } from "hono";
import prisma from "../clients/prisma";
import { authMiddleware } from "../middleware/auth";
import { contractService } from "../services/contract.service";
import { generateUserShieldedAddress, CONVERGENCE_API } from "../lib/convergence-client";
import { getAddress } from "viem";

type Variables = {
    user: string;
    sessionId: string;
}

const user = new Hono<{ Variables: Variables }>();

// ── GET /me ──
user.get("/me", authMiddleware, async (c) => {
    const userAddress = c.get("user") as string;

    try {
        const userData = await prisma.user.findUnique({
            where: { address: userAddress },
            include: {
                balances: true,
            },
        });

        if (!userData) {
            return c.json({ error: "User not found" }, 404);
        }

        // Return user data without sensitive fields if any (nonce is already public/random string but maybe omit it)
        // Return user data without sensitive fields
        const { nonce, ...safeUser } = userData;

        // Sync verification status if false in DB
        if (!safeUser.isVerified) {
            const isVerifiedOnChain = await contractService.getIsVerified(userAddress);
            if (isVerifiedOnChain) {
                // Update DB
                await prisma.user.update({
                    where: { address: userAddress },
                    data: { isVerified: true },
                });
                safeUser.isVerified = true;
            }
        }

        return c.json({
            success: true,
            user: safeUser,
        });
    } catch (err) {
        console.error("[user] Get /me failed:", err);
        return c.json({ error: "Failed to fetch user details" }, 500);
    }
});

// ── GET /orders ──
user.get("/orders", authMiddleware, async (c) => {
    const userAddress = c.get("user") as string;
    const status = c.req.query("status"); // Optional filter

    try {
        const whereClause: any = { userAddress };
        if (status) {
            whereClause.status = status;
        }

        const orders = await prisma.order.findMany({
            where: {
                ...whereClause,
                userAddress: { equals: userAddress, mode: "insensitive" }
            },
            orderBy: { createdAt: "desc" },
        });

        return c.json({
            success: true,
            orders,
        });
    } catch (err) {
        console.error("[user] Get /orders failed:", err);
        return c.json({ error: "Failed to fetch user orders" }, 500);
    }
});

// ── POST /shield-address ──
// User signs the EIP-712 "Generate Shielded Address" request client-side
// and passes { timestamp, auth } here. The backend injects their address
// from the session and proxies to the Convergence API.
user.post("/shield-address", authMiddleware, async (c) => {
    const userAddress = (c.get("user") as string);
    const body = await c.req.json<{ timestamp: number; auth: string }>();

    if (!body.timestamp || !body.auth) {
        return c.json({ error: "timestamp and auth are required" }, 400);
    }
    if (Math.abs(Date.now() / 1000 - body.timestamp) > 300) {
        return c.json({ error: "timestamp expired (must be within 5 minutes)" }, 400);
    }

    try {
        const address = await generateUserShieldedAddress({
            account: getAddress(userAddress),
            auth: body.auth,
            timestamp: body.timestamp,
        });
        return c.json({ address });
    } catch (err: any) {
        console.error("[user/shield-address]", err);
        return c.json({ error: err.message || "Failed to generate shielded address" }, 500);
    }
});

// ── POST /withdraw-ticket ──
// User signs EIP-712 "Withdraw Tokens" client-side and passes { token, amount, timestamp, auth }.
// Backend injects their address, proxies to Convergence /withdraw, returns { ticket, deadline }.
user.post("/withdraw-ticket", authMiddleware, async (c) => {
    const userAddress = (c.get("user") as string);
    const body = await c.req.json<{ token: string; amount: string; timestamp: number; auth: string }>();

    if (!body.token || !body.amount || !body.timestamp || !body.auth) {
        return c.json({ error: "token, amount, timestamp, and auth are required" }, 400);
    }
    if (Math.abs(Date.now() / 1000 - body.timestamp) > 300) {
        return c.json({ error: "timestamp expired (must be within 5 minutes)" }, 400);
    }

    try {
        const res = await fetch(`${CONVERGENCE_API}/withdraw`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                account: getAddress(userAddress),
                token: body.token,
                amount: body.amount,
                timestamp: body.timestamp,
                auth: body.auth,
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error("[user/withdraw-ticket] Convergence error:", err);
            return c.json({ error: (err as any).error_details || (err as any).error || "Failed to get withdrawal ticket" }, 502);
        }

        const json = await res.json();
        return c.json({ success: true, ticket: json.ticket, deadline: json.deadline, transaction_id: json.transaction_id });
    } catch (err: any) {
        console.error("[user/withdraw-ticket]", err);
        return c.json({ error: err.message || "Failed to get withdrawal ticket" }, 500);
    }
});

// ── POST /vault-balances ──
// User signs EIP-712 "Retrieve Balances" client-side and passes { timestamp, auth } here.
// Backend injects their address from session and proxies to the Convergence API.
user.post("/vault-balances", authMiddleware, async (c) => {
    const userAddress = (c.get("user") as string);
    const body = await c.req.json<{ timestamp: number; auth: string }>();

    if (!body.timestamp || !body.auth) {
        return c.json({ error: "timestamp and auth are required" }, 400);
    }
    if (Math.abs(Date.now() / 1000 - body.timestamp) > 300) {
        return c.json({ error: "timestamp expired (must be within 5 minutes)" }, 400);
    }

    try {
        const res = await fetch(`${CONVERGENCE_API}/balances`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                account: getAddress(userAddress),
                timestamp: body.timestamp,
                auth: body.auth,
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error("[user/vault-balances] Convergence error:", err);
            return c.json({ error: (err as any).error_details || "Failed to fetch vault balances" }, 502);
        }

        const json = await res.json();
        return c.json({ success: true, balances: json.balances ?? [] });
    } catch (err: any) {
        console.error("[user/vault-balances]", err);
        return c.json({ error: err.message || "Failed to fetch vault balances" }, 500);
    }
});

export { user };
