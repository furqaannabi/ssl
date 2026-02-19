import { Hono } from "hono";
import prisma from "../clients/prisma";

const pairs = new Hono();

// ── GET / (List all trading pairs) ──
pairs.get("/", async (c) => {
    try {
        const allPairs = await prisma.pair.findMany({
            include: {
                baseToken: { select: { symbol: true, name: true, address: true, decimals: true, chainSelector: true } },
                quoteToken: { select: { symbol: true, name: true, address: true, decimals: true, chainSelector: true } },
            },
        });

        return c.json({ success: true, pairs: allPairs });
    } catch (err) {
        console.error("[pairs] Fetch failed:", err);
        return c.json({ error: "Failed to fetch pairs" }, 500);
    }
});

export { pairs };
