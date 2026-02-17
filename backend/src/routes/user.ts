
import { Hono } from "hono";
import prisma from "../clients/prisma";
import { authMiddleware } from "../middleware/auth";
import { contractService } from "../services/contract.service";

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

export { user };
