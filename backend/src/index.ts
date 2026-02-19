// ──────────────────────────────────────────────
// SSL Backend — Entry Point
// ──────────────────────────────────────────────

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "./lib/config";
import { health } from "./routes/health";
import { verify } from "./routes/verify";
import { order } from "./routes/order";
import { auth } from "./routes/auth";
import { user } from "./routes/user";
import { pairs } from "./routes/pairs";
import { startVaultListener } from "./listeners/ssl-vault-listener";

const app = new Hono();

// ── Middleware ──
app.use("*", logger());
app.use(
    "*",
    cors({
        origin: ["http://localhost:5173", "http://localhost:3000"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization", "Cookie"],
        credentials: true,
    })
);

// ── Routes ──
app.route("/api/health", health);
app.route("/api/verify", verify);
app.route("/api/order", order);
app.route("/api/auth", auth);
app.route("/api/user", user);
app.route("/api/pairs", pairs);
app.route("/api/withdraw", withdraw);

// ── 404 ──
app.notFound((c) => c.json({ error: "Not found" }, 404));

// ── Error handler ──
app.onError((err, c) => {
    console.error("[server] Unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
});

// ── Start ──
console.log(`
╔══════════════════════════════════════╗
║   SSL Backend — Stealth Settlement  ║
║   Port: ${String(config.port).padEnd(28)}║
╚══════════════════════════════════════╝`
);

// Start Vault Listener
startVaultListener().catch((err) => {
    console.error("Failed to start vault listener:", err);
});

export default {
    port: config.port,
    fetch: app.fetch,
};
