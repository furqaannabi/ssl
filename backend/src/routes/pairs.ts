import { Hono } from "hono";
import prisma from "../clients/prisma";

const pairs = new Hono();

// ── GET / (List all trading pairs) ──
pairs.get("/", async (c) => {
    try {
        const allPairs = await prisma.pair.findMany();

        // For each pair, attach token addresses available per chain
        const result = await Promise.all(allPairs.map(async (pair) => {
            const tokens = await prisma.token.findMany({
                where: { symbol: pair.baseSymbol },
                select: { address: true, chainSelector: true, decimals: true },
            });

            return {
                id: pair.id,
                baseSymbol: pair.baseSymbol,
                quoteSymbol: "USDC",
                tokens, // available base token addresses per chain
            };
        }));

        return c.json({ success: true, pairs: result });
    } catch (err) {
        console.error("[pairs] Fetch failed:", err);
        return c.json({ error: "Failed to fetch pairs" }, 500);
    }
});

export { pairs };
