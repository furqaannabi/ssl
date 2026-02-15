// ──────────────────────────────────────────────
// GET /api/health
// ──────────────────────────────────────────────

import { Hono } from "hono";
// import { account } from "../lib/cre-client";
import { config } from "../lib/config";

const health = new Hono();

health.get("/", (c) => {
    return c.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        // signer: account.address, // Removed as cre-client no longer exports account
        // creEndpoint: config.creWorkflowUrl, // Removed - unused
    });
});

export { health };
