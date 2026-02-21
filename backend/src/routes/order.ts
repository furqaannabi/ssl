// ──────────────────────────────────────────────
// POST /api/order
// ──────────────────────────────────────────────
// Receives an order from the frontend and forwards
// it to the CRE workflow as a signed HTTP payload.

import { Hono } from "hono";
import prisma from "../clients/prisma";
import { matchOrders } from "../lib/matching-engine";
import { OrderSide, OrderStatus } from "../../generated/prisma/client";
import { streamText } from 'hono/streaming'
import { authMiddleware } from "../middleware/auth";


type Variables = {
    user: string;
    sessionId: string;
}

const order = new Hono<{ Variables: Variables }>();

interface OrderInitPayload {
    pairId: string;
    amount: string;
    price: string;
    side: "BUY" | "SELL";
    stealthAddress: string;
    userAddress: string;
    baseChainSelector: string;   // chain where RWA token is (both sides must agree)
    quoteChainSelector: string;  // chain where USDC is — buyer chooses
}

interface OrderConfirmPayload {
    signature: string;
}

// ── POST / (Place Order — unified: create + open + match in one request) ──
order.post("/", authMiddleware, async (c) => {
    const body = await c.req.json<OrderInitPayload>();
    const userAddress = (c.get("user") as string).toLowerCase();

    // Validate required fields
    const required = ["pairId", "amount", "price", "side", "stealthAddress", "baseChainSelector", "quoteChainSelector"] as const;
    for (const field of required) {
        if (!body[field]) return c.json({ error: `Missing required field: ${field}` }, 400);
    }

    if (body.side !== "BUY" && body.side !== "SELL") {
        return c.json({ error: "side must be BUY or SELL" }, 400);
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(body.stealthAddress)) {
        return c.json({ error: "Invalid stealthAddress. Must be a valid Ethereum address (0x + 40 hex chars)." }, 400);
    }

    const parsedAmount = parseFloat(body.amount);
    const parsedPrice = parseFloat(body.price);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return c.json({ error: "amount must be a positive number" }, 400);
    if (isNaN(parsedPrice) || parsedPrice <= 0) return c.json({ error: "price must be a positive number" }, 400);

    const orderValue = parsedAmount * parsedPrice;
    if (orderValue < 5) return c.json({ error: `Minimum order value is 5 USDC (current: ${orderValue.toFixed(2)})` }, 400);

    try {
        const pair = await prisma.pair.findUnique({ where: { id: body.pairId } });
        if (!pair) return c.json({ error: "Invalid pairId: pair not found" }, 400);

        // Create order directly as OPEN
        const newOrder = await prisma.order.create({
            data: {
                pairId: body.pairId,
                amount: body.amount,
                price: body.price,
                side: body.side as OrderSide,
                stealthAddress: body.stealthAddress,
                status: OrderStatus.OPEN,
                userAddress,
                baseChainSelector: body.baseChainSelector,
                quoteChainSelector: body.quoteChainSelector,
            },
        });

        console.log(`[order] Created OPEN order ${newOrder.id} for ${userAddress}`);

        // Stream matching engine logs back to client
        return streamText(c, async (stream) => {
            await stream.writeln(JSON.stringify({ type: 'log', message: `Order placed: ${newOrder.id.slice(0, 8)}... Running matching engine...` }));

            try {
                await matchOrders(newOrder.id, async (log) => {
                    await stream.writeln(JSON.stringify({ type: 'log', message: log }));
                });

                const finalOrder = await prisma.order.findUnique({ where: { id: newOrder.id } });
                await stream.writeln(JSON.stringify({
                    type: 'result',
                    success: true,
                    orderId: newOrder.id,
                    status: finalOrder?.status || "OPEN",
                }));
            } catch (err) {
                console.error("[order] Matching failed:", err);
                await stream.writeln(JSON.stringify({
                    type: 'error',
                    error: "Matching engine failed",
                    detail: err instanceof Error ? err.message : String(err),
                }));
            }
        });

    } catch (err) {
        console.error("[order] Create failed:", err);
        return c.json({ error: "Failed to place order", detail: String(err) }, 500);
    }
});

// ── GET /book (Orderbook) ──
order.get("/book", async (c) => {
    const pairId = c.req.query("pairId");

    try {
        const whereClause: any = { status: "OPEN" };
        if (pairId) {
            whereClause.pairId = pairId;
        }

        const orders = await prisma.order.findMany({
            where: whereClause,
            orderBy: { createdAt: "desc" },
            include: { pair: true },
        });

        return c.json({
            success: true,
            orders,
        });
    } catch (err) {
        console.error("[order] Get book failed:", err);
        return c.json({ error: "Failed to fetch orderbook" }, 500);
    }
});


// ── POST /:id/cancel ──
order.post("/:id/cancel", authMiddleware, async (c) => {
    const id = c.req.param("id");
    const userAddress = c.get("user") as string;

    try {
        const existingOrder = await prisma.order.findUnique({
            where: { id },
        });

        if (!existingOrder) {
            return c.json({ error: "Order not found" }, 404);
        }

        // Ensure ownership
        if (existingOrder.userAddress?.toLowerCase() !== userAddress.toLowerCase()) {
            return c.json({ error: "Unauthorized: You do not own this order" }, 403);
        }

        if (existingOrder.status !== "OPEN" && existingOrder.status !== "PENDING") {
            return c.json({ error: "Order cannot be cancelled (already matched or settled)" }, 400);
        }

        const cancelledOrder = await prisma.order.update({
            where: { id },
            data: { status: "CANCELLED" },
        });

        return c.json({
            success: true,
            orderId: cancelledOrder.id,
            status: "CANCELLED",
        });

    } catch (err) {
        console.error("[order] Cancel failed:", err);
        return c.json({ error: "Failed to cancel order" }, 500);
    }
});

export { order };
