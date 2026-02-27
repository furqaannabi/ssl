// ──────────────────────────────────────────────────────────────────────────────
// Order routes
//
// POST /api/order              — place an encrypted order (CRE TEE only)
// GET  /api/order/book         — public order book (obfuscated metadata)
// GET  /api/order/cre-pubkey   — return the CRE TEE's secp256k1 public key
// GET  /api/order/encrypted-book — encrypted order payloads for TEE to fetch
// POST /api/order/cre-settle   — CRE callback: settle a matched pair
// POST /api/order/parse        — NLP order parsing
// POST /api/order/:id/cancel   — cancel an open order
// ──────────────────────────────────────────────────────────────────────────────

import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { SigningKey } from "ethers";
import prisma from "../clients/prisma";
import { sendToMatchingWorkflow, type MatchOrderPayload } from "../lib/cre-client";
import { config } from "../lib/config";
import { authMiddleware } from "../middleware/auth";
import { NLParserService } from "../services/nl-parser.service";
import { PriceFeedService } from "../services/price-feed.service";
import { OrderSide, OrderStatus } from "../../generated/prisma/client";

type Variables = { user: string; sessionId: string };

const order = new Hono<{ Variables: Variables }>();

const ETH_SEPOLIA_SELECTOR = "ethereum-testnet-sepolia";

// ─── Extract result JSON from CRE stdout ─────────────────────────────────────

function extractCREResult(rawResult: any): Record<string, any> | null {
    if (rawResult && typeof rawResult === "object" && !("output" in rawResult)) return rawResult;
    if (rawResult?.output && typeof rawResult.output === "string") {
        const output = rawResult.output as string;
        const m = output.match(/Workflow Simulation Result:\s*"((?:[^"\\]|\\.)*)"/);
        if (m) {
            try { return JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\")); } catch { /* fall through */ }
        }
        for (const line of output.split("\n").reverse()) {
            const t = line.trim();
            if (!t.startsWith("{")) continue;
            try { return JSON.parse(t); } catch { /* skip */ }
        }
    }
    return null;
}

// ─── GET /cre-pubkey ─────────────────────────────────────────────────────────
// Returns the CRE TEE's compressed secp256k1 public key for frontend encryption.

order.get("/cre-pubkey", (c) => {
    try {
        const key = new SigningKey(config.creEncryptionKey);
        return c.json({ publicKey: key.compressedPublicKey });
    } catch {
        return c.json({ error: "CRE encryption key not configured" }, 500);
    }
});

// ─── GET /encrypted-book ─────────────────────────────────────────────────────
// Called by the CRE TEE (via Confidential HTTP) to fetch encrypted order payloads.

order.get("/encrypted-book", async (c) => {
    const pairId = c.req.query("pairId");
    try {
        const orders = await prisma.order.findMany({
            where: {
                status: OrderStatus.OPEN,
                encryptedPayload: { not: null },
                ...(pairId ? { pairId } : {}),
            },
            select: { id: true, encryptedPayload: true },
            orderBy: { createdAt: "asc" },
        });
        return c.json({ orders });
    } catch (err) {
        console.error("[encrypted-book]", err);
        return c.json({ error: "Failed" }, 500);
    }
});

// ─── GET /settle-info ─────────────────────────────────────────────────────────
// Single call: returns both shield addresses + token metadata for the TEE.
// Replaces the separate /settle-meta and /:id/party calls to stay within the
// CRE SDK HTTP call limit of 5 per workflow execution.

order.get("/settle-info", async (c) => {
    const secret = c.req.header("X-CRE-Secret");
    if (!secret || secret !== config.creCallbackSecret) {
        return c.json({ error: "Unauthorized" }, 401);
    }
    const buyerOrderId  = c.req.query("buyerOrderId");
    const sellerOrderId = c.req.query("sellerOrderId");
    const pairId        = c.req.query("pairId");
    if (!buyerOrderId || !sellerOrderId || !pairId) {
        return c.json({ error: "buyerOrderId, sellerOrderId, pairId required" }, 400);
    }

    const [buyerOrder, sellerOrder, pair] = await Promise.all([
        prisma.order.findUnique({ where: { id: buyerOrderId },  select: { shieldAddress: true } }),
        prisma.order.findUnique({ where: { id: sellerOrderId }, select: { shieldAddress: true } }),
        prisma.pair.findUnique({ where: { id: pairId } }),
    ]);
    if (!buyerOrder || !sellerOrder || !pair) return c.json({ error: "Not found" }, 404);

    const [baseToken, quoteToken] = await Promise.all([
        prisma.token.findFirst({ where: { symbol: pair.baseSymbol, chainSelector: ETH_SEPOLIA_SELECTOR } }),
        prisma.token.findFirst({ where: { symbol: "USDC",          chainSelector: ETH_SEPOLIA_SELECTOR } }),
    ]);
    if (!baseToken || !quoteToken) return c.json({ error: "Token metadata missing" }, 500);

    return c.json({
        buyerShieldAddress:  buyerOrder.shieldAddress,
        sellerShieldAddress: sellerOrder.shieldAddress,
        baseTokenAddress:    baseToken.address,
        quoteTokenAddress:   quoteToken.address,
        baseDecimals:        baseToken.decimals,
        quoteDecimals:       quoteToken.decimals,
    });
});

// ─── POST /cre-settle ────────────────────────────────────────────────────────
// CRE TEE calls this after settlement to update order status in DB.

order.post("/cre-settle", async (c) => {
    const secret = c.req.header("X-CRE-Secret");
    if (!secret || secret !== config.creCallbackSecret) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const body = await c.req.json<{
        buyerOrderId:  string;
        sellerOrderId: string;
        tradeAmount:   string;
        quoteAmount:   string;
        pairId:        string;
        buyerTxId?:    string | null;
        sellerTxId?:   string | null;
    }>();

    console.log(`[cre-settle] buyer=${body.buyerOrderId} seller=${body.sellerOrderId} buyerTx=${body.buyerTxId} sellerTx=${body.sellerTxId}`);

    try {
        await prisma.$transaction([
            prisma.order.update({ where: { id: body.buyerOrderId },  data: { filledAmount: body.tradeAmount, status: OrderStatus.SETTLED } }),
            prisma.order.update({ where: { id: body.sellerOrderId }, data: { filledAmount: body.tradeAmount, status: OrderStatus.SETTLED } }),
        ]);

        console.log(`[cre-settle] Orders marked SETTLED`);
        return c.json({ success: true, buyerTxId: body.buyerTxId, sellerTxId: body.sellerTxId });

    } catch (err: any) {
        console.error("[cre-settle] Failed:", err);
        return c.json({ error: "Settlement failed", detail: String(err) }, 500);
    }
});

// ─── POST /parse ─────────────────────────────────────────────────────────────

order.post("/parse", async (c) => {
    const body = await c.req.json<{ message: string; userAddress?: string }>();

    if (!body.message || typeof body.message !== "string") {
        return c.json({ error: "Message is required" }, 400);
    }

    try {
        const parsed = await NLParserService.parseOrderMessage(body.message);

        if (!parsed.isValid) {
            return c.json({ parsed, requiresConfirmation: false, balanceCheck: null });
        }

        const pair = await prisma.pair.findUnique({ where: { baseSymbol: parsed.symbol } });
        if (!pair) {
            return c.json({ parsed, requiresConfirmation: false, balanceCheck: null, error: `No pair for ${parsed.symbol}` });
        }

        let amount = parsed.amount;
        let price = parsed.price;

        if (parsed.dollarAmount && !parsed.amount) {
            let unitPrice: number;
            if (parsed.price) {
                unitPrice = parseFloat(parsed.price);
            } else {
                const priceData = await PriceFeedService.getPriceOrMock(parsed.symbol);
                unitPrice = priceData.price;
                price = priceData.price.toString();
            }
            amount = (parseFloat(parsed.dollarAmount) / unitPrice).toFixed(6);
        }

        const totalValue = parseFloat(amount) * parseFloat(price);

        return c.json({
            parsed: { ...parsed, amount, price, pairId: pair.id, chainSelector: ETH_SEPOLIA_SELECTOR },
            totalValue: totalValue.toFixed(2),
            requiresConfirmation: true,
            balanceCheck: { hasSufficientBalance: true, required: "", available: "", error: "" },
        });
    } catch (err: any) {
        console.error("[order/parse]", err);
        return c.json({ error: err.message || "Failed to parse message" }, 500);
    }
});

// ─── POST / — Place order ─────────────────────────────────────────────────────
// All orders must be encrypted for the CRE TEE. Plaintext fallback is removed.
// Optional side/amount/price are stored as display metadata only (not used for matching).

interface OrderBody {
    pairId: string;
    shieldAddress: string;
    baseChainSelector: string;
    quoteChainSelector: string;
    // Required: encrypted TEE path
    encrypted: string;   // base64 ECIES ciphertext
    signature: string;   // ECDSA sig over encrypted payload
    // Optional display metadata (stored in DB for order book UI, not used for matching)
    side?: "BUY" | "SELL";
    amount?: string;
    price?: string;
}

order.post("/", authMiddleware, async (c) => {
    const body = await c.req.json<OrderBody>();
    const userAddress = (c.get("user") as string).toLowerCase();

    if (!body.pairId || !body.shieldAddress || !body.baseChainSelector || !body.quoteChainSelector) {
        return c.json({ error: "Missing required field" }, 400);
    }
    if (body.baseChainSelector !== ETH_SEPOLIA_SELECTOR || body.quoteChainSelector !== ETH_SEPOLIA_SELECTOR) {
        return c.json({ error: `Only ETH Sepolia is supported — use "${ETH_SEPOLIA_SELECTOR}"` }, 400);
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(body.shieldAddress)) {
        return c.json({ error: "Invalid shieldAddress" }, 400);
    }
    if (!body.encrypted || !body.signature) {
        return c.json({ error: "Orders must be encrypted. Provide encrypted and signature fields." }, 400);
    }

    // Require World ID verification before placing orders
    const userRecord = await prisma.user.findUnique({ where: { address: userAddress }, select: { isVerified: true } });
    if (!userRecord?.isVerified) {
        return c.json({ error: "World ID verification required. Complete verification in the Compliance tab." }, 403);
    }

    const side: OrderSide = (body.side ?? "BUY") as OrderSide;

    const pair = await prisma.pair.findUnique({ where: { id: body.pairId } });
    if (!pair) return c.json({ error: "Invalid pairId" }, 400);

    const newOrder = await prisma.order.create({
        data: {
            pairId: body.pairId,
            side,
            amount: body.amount ?? "0",
            price: body.price ?? "0",
            shieldAddress: body.shieldAddress,
            userAddress,
            baseChainSelector: body.baseChainSelector,
            quoteChainSelector: body.quoteChainSelector,
            status: OrderStatus.PENDING,
            encryptedPayload: body.encrypted,
        },
    });

    console.log(`[order] ${newOrder.status} order ${newOrder.id} user=${userAddress}`);

    return streamText(c, async (stream) => {
        const log = (msg: string) => stream.writeln(JSON.stringify({ type: "log", message: msg }));

        await log("Forwarding encrypted order to CRE TEE...");
        try {
            await prisma.order.update({ where: { id: newOrder.id }, data: { status: OrderStatus.OPEN } });

            const rawResult = await sendToMatchingWorkflow(
                {
                    action:         "match_order",
                    encryptedOrder: body.encrypted,
                    signature:      body.signature,
                    pairId:         body.pairId,
                    orderId:        newOrder.id,
                },
                async (l) => { await log(l); }
            );
            const result = extractCREResult(rawResult);
            const finalOrder = await prisma.order.findUnique({ where: { id: newOrder.id } });

            await stream.writeln(JSON.stringify({
                type: "result", success: true,
                orderId: newOrder.id, status: finalOrder?.status ?? "OPEN",
                cre: result,
            }));
        } catch (err) {
            await log(`[TEE] Failed: ${err instanceof Error ? err.message : String(err)}`);
            await stream.writeln(JSON.stringify({ type: "error", error: "CRE matching failed", detail: String(err) }));
        }
    });
});

// ─── GET /book ────────────────────────────────────────────────────────────────

order.get("/book", async (c) => {
    const pairId = c.req.query("pairId");
    try {
        const orders = await prisma.order.findMany({
            where: { status: "OPEN", ...(pairId ? { pairId } : {}) },
            orderBy: { createdAt: "desc" },
            include: { pair: true },
        });
        return c.json({ success: true, orders });
    } catch (err) {
        console.error("[order/book]", err);
        return c.json({ error: "Failed to fetch orderbook" }, 500);
    }
});

// ─── POST /:id/cancel ─────────────────────────────────────────────────────────

order.post("/:id/cancel", authMiddleware, async (c) => {
    const id = c.req.param("id");
    const userAddress = c.get("user") as string;

    try {
        const existing = await prisma.order.findUnique({ where: { id } });
        if (!existing) return c.json({ error: "Order not found" }, 404);

        if (existing.userAddress?.toLowerCase() !== userAddress.toLowerCase()) {
            return c.json({ error: "Unauthorized" }, 403);
        }
        if (existing.status !== "OPEN" && existing.status !== "PENDING") {
            return c.json({ error: "Order cannot be cancelled" }, 400);
        }

        const cancelled = await prisma.order.update({ where: { id }, data: { status: "CANCELLED" } });
        return c.json({ success: true, orderId: cancelled.id, status: "CANCELLED" });
    } catch (err) {
        console.error("[order/cancel]", err);
        return c.json({ error: "Failed to cancel order" }, 500);
    }
});

export { order };
