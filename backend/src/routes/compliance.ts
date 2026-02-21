
import { Hono } from "hono";
import prisma from "../clients/prisma";
import { authMiddleware } from "../middleware/auth";
import { getOraclePrices } from "../lib/price-oracle";

const compliance = new Hono();

// ── GET /stats (Compliance Dashboard) ──
compliance.get("/stats", async (c) => {
    try {
        // 1. Oracle Status (Always fresh in mock)
        const oracleLastUpdate = new Date().toISOString();
        
        // 2. Verified Users Count
        const totalVerifiedUsers = await prisma.user.count({
            where: { isVerified: true }
        });

        // 3. Pending ZKP (Mock: Use pending orders count)
        const zkpPending = await prisma.order.count({
            where: { status: "PENDING" }
        });

        const zkpCompleted = await prisma.order.count({
             where: { status: { not: "PENDING" } }
        });

        // 4. Compliance Logs (Unified history of all users)
        // In a real system, this would be an immutable ledger. 
        // Here we show latest system activity.
        const recentOrders = await prisma.order.findMany({
            take: 10,
            orderBy: { createdAt: "desc" },
            include: { pair: true }
        });

        const recentTx = await prisma.transaction.findMany({
            take: 10,
            orderBy: { createdAt: "desc" }
        });
        
        // Merge & Sort
        const logs = [
            ...recentOrders.map(o => ({
                time: o.createdAt,
                event: `Order ${o.side} ${o.pair.baseSymbol}`,
                hash: o.stealthAddress ? `${o.stealthAddress.slice(0,6)}...` : "N/A",
                status: o.status === 'OPEN' ? 'LOGGED' : o.status,
                color: o.status === 'OPEN' ? 'yellow' : 'primary'
            })),
            ...recentTx.map(t => ({
                time: t.createdAt,
                event: `${t.type} ${t.token.slice(0,4)}...`, // Truncated asset
                hash: t.txHash ? `${t.txHash.slice(0,6)}...` : "N/A",
                status: 'CONFIRMED',
                color: 'primary'
            }))
        ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
         .slice(0, 15); // Limit to 15 items

        return c.json({
            success: true,
            stats: {
                oracleLastUpdate,
                totalVerifiedUsers,
                zkpPending,
                zkpCompleted,
                logs
            }
        });

    } catch (err) {
        console.error("[Compliance] Stats failed:", err);
        return c.json({ error: "Failed to fetch stats" }, 500);
    }
});

export { compliance };
