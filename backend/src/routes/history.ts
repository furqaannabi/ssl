
import { Hono } from "hono";
import prisma from "../clients/prisma";
import { authMiddleware } from "../middleware/auth";

type Variables = {
    user: string;
}

const history = new Hono<{ Variables: Variables }>();

// ── GET / (Unified History) ──
history.get("/", authMiddleware, async (c) => {
    const address = c.get("user");

    try {
        // 1. Fetch Orders
        const orders = await prisma.order.findMany({
            where: { userAddress: { equals: address, mode: 'insensitive' } },
            orderBy: { createdAt: "desc" },
            take: 50,
            include: { pair: true }
        });

        // 2. Fetch Transactions (Deposits/Withdrawals)
        const transactions = await prisma.transaction.findMany({
            where: { userAddress: { equals: address, mode: 'insensitive' } },
            orderBy: { createdAt: "desc" },
            take: 50
        });

        // 3. Normalize & Merge
        const historyItems = [
            ...orders.map((o: any) => ({
                id: o.id,
                type: "ORDER",
                side: o.side,
                status: o.status,
                asset: `${o.pair.baseSymbol}/USDC`,
                amount: o.amount,
                price: o.price,
                filled: o.filledAmount,
                hash: o.stealthPublicKey ? `${o.stealthPublicKey.slice(0,6)}...${o.stealthPublicKey.slice(-4)}` : "N/A",
                createdAt: o.createdAt
            })),
            ...transactions.map((t: any) => ({
                id: t.id,
                type: t.type, // DEPOSIT or WITHDRAWAL
                side: t.type === 'DEPOSIT' ? 'IN' : 'OUT',
                status: 'COMPLETED',
                asset: t.token, // Address (TODO: Resolve Symbol?)
                amount: t.amount,
                price: "-",
                filled: t.amount,
                hash: t.txHash ? `${t.txHash.slice(0,6)}...${t.txHash.slice(-4)}` : "N/A",
                createdAt: t.createdAt
            }))
        ];

        // 4. Sort Combined List (Newest First)
        historyItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return c.json({
            success: true,
            history: historyItems
        });

    } catch (err) {
        console.error("[History] Failed to fetch history:", err);
        return c.json({ error: "Failed to fetch history" }, 500);
    }
});

export default history;
