import { Hono } from "hono";
import { OracleService } from "../services/oracle.service";

const oracle = new Hono();

// ── GET /signal/:pairId (AI-lite Trend Signal) ──
oracle.get("/signal/:pairId", async (c) => {
    try {
        const pairId = c.req.param("pairId");
        const signal = await OracleService.getSignal(pairId);
        
        return c.json({
            success: true,
            data: signal,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("Oracle Error:", error);
        return c.json({ success: false, error: "Failed to fetch oracle signal" }, 500);
    }
});

export default oracle;
