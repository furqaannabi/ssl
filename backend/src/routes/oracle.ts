
import { Hono } from "hono";
import { getOraclePrices } from "../lib/price-oracle";

const oracle = new Hono();

// ── GET /prices (Current Oracle Prices) ──
oracle.get("/prices", (c) => {
    const prices = getOraclePrices();
    return c.json({
        success: true,
        prices
    });
});

export default oracle;
