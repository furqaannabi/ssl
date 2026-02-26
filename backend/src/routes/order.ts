// ──────────────────────────────────────────────────────────────────────────────
// Order routes
//
// POST /api/order              — place an order (encrypted TEE path + fallback)
// GET  /api/order/book         — public order book (plaintext metadata)
// GET  /api/order/cre-pubkey   — return the CRE TEE's secp256k1 public key
// GET  /api/order/encrypted-book — encrypted order payloads for TEE to fetch
// POST /api/order/cre-settle   — CRE callback: settle a matched pair
// POST /api/order/parse        — NLP order parsing
// POST /api/order/:id/cancel   — cancel an open order
// ──────────────────────────────────────────────────────────────────────────────

import { Hono }       from "hono";
import { streamText } from "hono/streaming";
import { SigningKey, parseUnits } from "ethers";
import prisma         from "../clients/prisma";
import { matchOrders } from "../lib/matching-engine";
import { sendToMatchingWorkflow, type MatchOrderPayload } from "../lib/cre-client";
import { settleMatch } from "../lib/convergence-client";
import { config }     from "../lib/config";
import { authMiddleware } from "../middleware/auth";
import { NLParserService }  from "../services/nl-parser.service";
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
            select:  { id: true, encryptedPayload: true },
            orderBy: { createdAt: "asc" },
        });
        return c.json({ orders });
    } catch (err) {
        console.error("[encrypted-book]", err);
        return c.json({ error: "Failed" }, 500);
    }
});

// ─── POST /cre-settle ────────────────────────────────────────────────────────
// CRE TEE calls this after matching. Backend settles via Convergence API + updates DB.

order.post("/cre-settle", async (c) => {
    const secret = c.req.header("X-CRE-Secret");
    if (!secret || secret !== config.creCallbackSecret) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const body = await c.req.json<{
        buyerOrderId:         string;
        sellerOrderId:        string;
        buyerStealthAddress:  string;
        sellerStealthAddress: string;
        tradeAmount:          string;
        quoteAmount:          string;
        pairId:               string;
    }>();

    console.log(`[cre-settle] buyer=${body.buyerOrderId} seller=${body.sellerOrderId}`);

    try {
        const buyerOrder = await prisma.order.findUnique({
            where:   { id: body.buyerOrderId },
            include: { pair: true },
        });

        const baseSymbol = buyerOrder?.pair?.baseSymbol ?? "";
        const [exactBaseToken, quoteToken] = await Promise.all([
            prisma.token.findFirst({ where: { chainSelector: ETH_SEPOLIA_SELECTOR, symbol: baseSymbol } }),
            prisma.token.findFirst({ where: { chainSelector: ETH_SEPOLIA_SELECTOR, symbol: "USDC" } }),
        ]);

        if (!exactBaseToken || !quoteToken) {
            return c.json({ error: "Token addresses not found" }, 500);
        }

        const baseAmountWei  = parseUnits(parseFloat(body.tradeAmount).toFixed(exactBaseToken.decimals), exactBaseToken.decimals);
        const quoteAmountWei = parseUnits(parseFloat(body.quoteAmount).toFixed(quoteToken.decimals),     quoteToken.decimals);

        await prisma.$transaction([
            prisma.order.update({ where: { id: body.buyerOrderId  }, data: { filledAmount: body.tradeAmount, status: OrderStatus.SETTLED } }),
            prisma.order.update({ where: { id: body.sellerOrderId }, data: { filledAmount: body.tradeAmount, status: OrderStatus.SETTLED } }),
        ]);

        const result = await settleMatch({
            buyerStealthAddress:  body.buyerStealthAddress,
            sellerStealthAddress: body.sellerStealthAddress,
            baseTokenAddress:     exactBaseToken.address,
            quoteTokenAddress:    quoteToken.address,
            baseAmountWei:        baseAmountWei.toString(),
            quoteAmountWei:       quoteAmountWei.toString(),
        });

        console.log(`[cre-settle] Done. buyerTx=${result.buyerTxId} sellerTx=${result.sellerTxId}`);
        return c.json({ success: true, buyerTxId: result.buyerTxId, sellerTxId: result.sellerTxId });

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
        let price  = parsed.price;

        if (parsed.dollarAmount && !parsed.amount) {
            let unitPrice: number;
            if (parsed.price) {
                unitPrice = parseFloat(parsed.price);
            } else {
                const priceData = await PriceFeedService.getPriceOrMock(parsed.symbol);
                unitPrice = priceData.price;
                price     = priceData.price.toString();
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
// Accepts an encrypted order for the TEE path (recommended for privacy) or
// plaintext fields for the fallback local matching path.

interface OrderBody {
    pairId:             string;
    stealthAddress:     string;
    baseChainSelector:  string;
    quoteChainSelector: string;
    // Encrypted TEE path
    encrypted?:         string;   // base64 ECIES ciphertext
    signature?:         string;   // ECDSA sig over encrypted payload
    fallbackEnabled?:   boolean;
    // Plaintext (for fallback + UI display)
    side?:   "BUY" | "SELL";
    amount?: string;
    price?:  string;
}

order.post("/", authMiddleware, async (c) => {
    const body        = await c.req.json<OrderBody>();
    const userAddress = (c.get("user") as string).toLowerCase();

    if (!body.pairId || !body.stealthAddress || !body.baseChainSelector || !body.quoteChainSelector) {
        return c.json({ error: "Missing required field" }, 400);
    }
    if (body.baseChainSelector !== ETH_SEPOLIA_SELECTOR || body.quoteChainSelector !== ETH_SEPOLIA_SELECTOR) {
        return c.json({ error: `Only ETH Sepolia is supported — use "${ETH_SEPOLIA_SELECTOR}"` }, 400);
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(body.stealthAddress)) {
        return c.json({ error: "Invalid stealthAddress" }, 400);
    }

    const hasEncrypted = !!body.encrypted;
    const hasPlaintext = !!(body.side && body.amount && body.price);

    if (!hasEncrypted && !hasPlaintext) {
        return c.json({ error: "Provide encrypted payload or plaintext side/amount/price" }, 400);
    }

    let side: OrderSide = (body.side ?? "BUY") as OrderSide;
    let parsedAmount = 0;
    let parsedPrice  = 0;

    if (hasPlaintext) {
        if (body.side !== "BUY" && body.side !== "SELL") return c.json({ error: "side must be BUY or SELL" }, 400);
        parsedAmount = parseFloat(body.amount!);
        parsedPrice  = parseFloat(body.price!);
        if (isNaN(parsedAmount) || parsedAmount <= 0) return c.json({ error: "amount must be a positive number" }, 400);
        if (isNaN(parsedPrice)  || parsedPrice  <= 0) return c.json({ error: "price must be a positive number"  }, 400);
        if (Math.round(parsedAmount * parsedPrice * 100) / 100 < 4.99) {
            return c.json({ error: `Minimum order value is 5 USDC (current: ${(parsedAmount * parsedPrice).toFixed(2)})` }, 400);
        }
        side = body.side! as OrderSide;
    }

    const pair = await prisma.pair.findUnique({ where: { id: body.pairId } });
    if (!pair) return c.json({ error: "Invalid pairId" }, 400);

    const newOrder = await prisma.order.create({
        data: {
            pairId:             body.pairId,
            side,
            amount:             body.amount  ?? "0",
            price:              body.price   ?? "0",
            stealthAddress:     body.stealthAddress,
            userAddress,
            baseChainSelector:  body.baseChainSelector,
            quoteChainSelector: body.quoteChainSelector,
            status:             hasEncrypted ? OrderStatus.PENDING : OrderStatus.OPEN,
            encryptedPayload:   body.encrypted ?? null,
        },
    });

    console.log(`[order] ${newOrder.status} order ${newOrder.id} user=${userAddress}`);

    return streamText(c, async (stream) => {
        const log = (msg: string) => stream.writeln(JSON.stringify({ type: "log", message: msg }));

        // ── Encrypted TEE path ─────────────────────────────────────────────────
        if (hasEncrypted) {
            await log("Forwarding encrypted order to CRE TEE...");
            try {
                await prisma.order.update({ where: { id: newOrder.id }, data: { status: OrderStatus.OPEN } });

                const rawResult = await sendToMatchingWorkflow(
                    { action: "match_order", encryptedOrder: body.encrypted!, signature: body.signature ?? "", pairId: body.pairId, orderId: newOrder.id },
                    async (l) => { await log(l); }
                );
                const result     = extractCREResult(rawResult);
                const finalOrder = await prisma.order.findUnique({ where: { id: newOrder.id } });

                await stream.writeln(JSON.stringify({
                    type: "result", success: true,
                    orderId: newOrder.id, status: finalOrder?.status ?? "OPEN",
                    cre: result, mode: "tee",
                }));
                return;

            } catch (err) {
                await log(`[TEE] Failed: ${err instanceof Error ? err.message : String(err)}`);

                if (body.fallbackEnabled && hasPlaintext) {
                    await log("[Fallback] CRE unavailable — running local matching...");
                    // continue to plaintext matching below
                } else {
                    await stream.writeln(JSON.stringify({ type: "error", error: "CRE matching failed", detail: String(err) }));
                    return;
                }
            }
        }

        // ── Plaintext / fallback matching ──────────────────────────────────────
        try {
            await matchOrders(newOrder.id, async (l) => { await log(l); });
            const finalOrder = await prisma.order.findUnique({ where: { id: newOrder.id } });
            await stream.writeln(JSON.stringify({
                type: "result", success: true,
                orderId: newOrder.id, status: finalOrder?.status ?? "OPEN",
                mode: hasEncrypted ? "fallback" : "plaintext",
            }));
        } catch (err) {
            console.error("[order] Matching failed:", err);
            await stream.writeln(JSON.stringify({
                type: "error", error: "Matching engine failed",
                detail: err instanceof Error ? err.message : String(err),
            }));
        }
    });
});

// ─── GET /book ────────────────────────────────────────────────────────────────

order.get("/book", async (c) => {
    const pairId = c.req.query("pairId");
    try {
        const orders = await prisma.order.findMany({
            where:   { status: "OPEN", ...(pairId ? { pairId } : {}) },
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
    const id          = c.req.param("id");
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
