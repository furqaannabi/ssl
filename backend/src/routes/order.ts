// ──────────────────────────────────────────────
// POST /api/order
// ──────────────────────────────────────────────
// Receives an order from the frontend and forwards
// it to the CRE workflow as a signed HTTP payload.

import { Hono } from "hono";
import prisma from "../clients/prisma";
import { matchOrders } from "../lib/matching-engine";
import { OrderSide, OrderStatus } from "../../generated/prisma/client";

const order = new Hono();

interface OrderRequest {
    nullifierHash: string;
    asset: string;
    quoteToken: string;
    amount: string;
    price: string;
    side: "BUY" | "SELL";
    stealthPublicKey: string;
}

order.post("/", async (c) => {
    const body = await c.req.json<OrderRequest>();

    // Validate required fields
    const required = [
        "nullifierHash",
        "asset",
        "quoteToken",
        "amount",
        "price",
        "side",
        "stealthPublicKey",
    ] as const;

    for (const field of required) {
        if (!body[field]) {
            return c.json({ error: `Missing required field: ${field}` }, 400);
        }
    }

    if (body.side !== "BUY" && body.side !== "SELL") {
        return c.json({ error: "side must be BUY or SELL" }, 400);
    }

    console.log(
        `[order] ${body.side} ${body.amount} @ ${body.price} | nullifier: ${body.nullifierHash.slice(0, 10)}...`
    );


    try {
        const newOrder = await prisma.order.create({
            data: {
                nullifierHash: body.nullifierHash,
                asset: body.asset,
                quoteToken: body.quoteToken,
                amount: body.amount,
                price: body.price,
                side: body.side as OrderSide,
                stealthPublicKey: body.stealthPublicKey,
                status: OrderStatus.OPEN,
            },
        });

        console.log(`[order] Created order ${newOrder.id}`);

        matchOrders(newOrder.id).catch((err) => {
            console.error("[order] Matching failed:", err);
        });

        return c.json({
            success: true,
            orderId: newOrder.id,
            status: "OPEN",
        });
    } catch (err) {
        console.error("[order] CRE forward failed:", err);
        return c.json(
            {
                error: "CRE forward failed",
                detail: err instanceof Error ? err.message : String(err),
            },
            502
        );
    }
});

export { order };
