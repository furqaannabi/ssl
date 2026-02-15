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

const order = new Hono();

interface OrderInitPayload {
    nullifierHash: string;
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
order.post("/:id/confirm", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<OrderConfirmPayload>();

    if (!body.signature) {
        return c.json({ error: "Missing signature" }, 400);
    }

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

        // Verify Signature
        const recoveredAddress = await recoverMessageAddress({
            message: existingOrder.id,
            signature: body.signature as `0x${string}`,
        });

        if (recoveredAddress.toLowerCase() !== existingOrder.userAddress.toLowerCase()) {
            return c.json({ error: "Invalid signature. Signer does not match order userAddress." }, 401);
        }

        // Activate Order
        const updatedOrder = await prisma.order.update({
            where: { id },
            data: { status: "OPEN" },
        });

        console.log(`[order] Order ${id} verified and OPENED.`);

        // Trigger Matching Engine
        // Non-blocking catch
        matchOrders(updatedOrder.id).catch((err) => {
            console.error("[order] Matching failed:", err);
        });

        return c.json({
            success: true,
            orderId: updatedOrder.id,
            status: "OPEN",
        });

    } catch (err) {
        console.error("[order] Confirmation failed:", err);
        return c.json({ error: "Order confirmation failed", detail: String(err) }, 500);
    }
});
export { order };
