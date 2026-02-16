// ──────────────────────────────────────────────
// POST /api/order
// ──────────────────────────────────────────────
// Receives an order from the frontend and forwards
// it to the CRE workflow as a signed HTTP payload.

import { Hono } from "hono";
import prisma from "../clients/prisma";
import { matchOrders } from "../lib/matching-engine";
import { OrderSide, OrderStatus } from "../../generated/prisma/client";
import { recoverMessageAddress } from "viem";
import { streamText } from 'hono/streaming'
import { authMiddleware } from "../middleware/auth";


type Variables = {
    user: string;
    sessionId: string;
}

const order = new Hono<{ Variables: Variables }>();

interface OrderInitPayload {
    asset: string;
    quoteToken: string;
    amount: string;
    price: string;
    side: "BUY" | "SELL";
    stealthPublicKey: string;
    userAddress: string; // Required for signature verification
}

interface OrderConfirmPayload {
    signature: string;
}

// ── Step 1: Create Order (PENDING) ──
order.post("/", async (c) => {
    const body = await c.req.json<OrderInitPayload>();

    // Validate required fields
    const required = [
        "asset",
        "quoteToken",
        "amount",
        "price",
        "side",
        "stealthPublicKey",
        "userAddress",
    ] as const;

    for (const field of required) {
        if (!body[field]) {
            return c.json({ error: `Missing required field: ${field}` }, 400);
        }
    }

    if (body.side !== "BUY" && body.side !== "SELL") {
        return c.json({ error: "side must be BUY or SELL" }, 400);
    }

    try {
        // Create order as PENDING
        const newOrder = await prisma.order.create({
            data: {
                asset: body.asset,
                quoteToken: body.quoteToken,
                amount: body.amount,
                price: body.price,
                side: body.side as OrderSide,
                stealthPublicKey: body.stealthPublicKey,
                status: OrderStatus.PENDING, // Wait for signature
                userAddress: body.userAddress,
            },
        });

        console.log(`[order] Created PENDING order ${newOrder.id} for ${body.userAddress}`);

        return c.json({
            success: true,
            orderId: newOrder.id,
            messageToSign: newOrder.id,
            status: "PENDING",
        });
    } catch (err) {
        console.error("[order] DB create failed:", err);
        return c.json({ error: "Failed to create order", detail: String(err) }, 500);
    }
});

// ── Step 2: Confirm Order (OPEN) ──
order.post("/:id/confirm", authMiddleware, async (c) => {
    const id = c.req.param("id");
    // const body = await c.req.json<OrderConfirmPayload>();
    const userAddress = c.get("user") as string;

    /* if (!body.signature) {
        return c.json({ error: "Missing signature" }, 400);
    } */

    try {
        const existingOrder = await prisma.order.findUnique({
            where: { id },
        });

        if (!existingOrder) {
            return c.json({ error: "Order not found" }, 404);
        }

        if (existingOrder.status !== "PENDING") {
            return c.json({ success: true, status: existingOrder.status, message: "Order already processed" });
        }

        if (!existingOrder.userAddress) {
            return c.json({ error: "Order has no user address to verify against" }, 400);
        }

        // Ensure ownership
        if (existingOrder.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
            return c.json({ error: "Unauthorized: You do not own this order" }, 403);
        }

        // Activate Order
        const updatedOrder = await prisma.order.update({
            where: { id },
            data: { status: "OPEN" },
        });

        console.log(`[order] Order ${id} verified and OPENED.`);

        // Trigger Matching Engine with SSE
        return streamText(c, async (stream) => {
            await stream.writeln(JSON.stringify({ type: 'log', message: 'Order verified and OPENED. Starting matching engine...' }));

            try {
                await matchOrders(updatedOrder.id, async (log) => {
                    await stream.writeln(JSON.stringify({ type: 'log', message: log }));
                });

                // Fetch latest status
                const finalOrder = await prisma.order.findUnique({ where: { id: updatedOrder.id } });

                await stream.writeln(JSON.stringify({
                    type: 'result',
                    success: true,
                    orderId: updatedOrder.id,
                    status: finalOrder?.status || "OPEN",
                }));
                // Note: we might want to fetch the fresh status to return here
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
        console.error("[order] Confirmation failed:", err);
        return c.json({ error: "Order confirmation failed", detail: String(err) }, 500);
    }
});

// ── GET /book (Orderbook) ──
order.get("/book", async (c) => {
    try {
        const orders = await prisma.order.findMany({
            where: { status: "OPEN" },
            orderBy: { createdAt: "desc" },
            // Optionally, we could select only necessary fields
            // select: { id: true, asset: true, ... }
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
