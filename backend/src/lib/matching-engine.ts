
import prisma from "../clients/prisma";
import { OrderSide, OrderStatus } from "../../generated/prisma/client";
import { sendToCRE } from "./cre-client";

export async function matchOrders(newOrderId: string) {
    const newOrder = await prisma.order.findUnique({
        where: { id: newOrderId },
    });

    if (!newOrder || newOrder.status !== OrderStatus.OPEN) {
        return;
    }

    const oppositeSide = newOrder.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;

    // Simple matching (price/time priority logic simplified for MVP)
    // Buy: match with lowest sell price <= buy price
    // Sell: match with highest buy price >= sell price

    let match;
    if (newOrder.side === OrderSide.BUY) {
        match = await prisma.order.findFirst({
            where: {
                side: oppositeSide,
                status: OrderStatus.OPEN,
                asset: newOrder.asset,
                quoteToken: newOrder.quoteToken,
                price: { lte: newOrder.price }, // Sell price <= Buy price
            },
            orderBy: {
                price: 'asc', // Lowest sell price first
            }
        });
    } else {
        match = await prisma.order.findFirst({
            where: {
                side: oppositeSide,
                status: OrderStatus.OPEN,
                asset: newOrder.asset,
                quoteToken: newOrder.quoteToken,
                price: { gte: newOrder.price }, // Buy price >= Sell price
            },
            orderBy: {
                price: 'desc', // Highest buy price first
            }
        });
    }

    if (match) {
        console.log(`[MatchingEngine] Match found: ${newOrder.id} matches with ${match.id}`);

        // Update status to MATCHED
        await prisma.$transaction([
            prisma.order.update({
                where: { id: newOrder.id },
                data: { status: OrderStatus.MATCHED },
            }),
            prisma.order.update({
                where: { id: match.id },
                data: { status: OrderStatus.MATCHED },
            }),
        ]);

        // Trigger Settlement via CRE
        try {
            const buyer = newOrder.side === OrderSide.BUY ? newOrder : match;
            const seller = newOrder.side === OrderSide.SELL ? newOrder : match;

            await sendToCRE({
                action: "settle_match",
                buyer: {
                    nullifierHash: buyer.nullifierHash,
                    orderId: buyer.id,
                    order: {
                        asset: buyer.asset,
                        quoteToken: buyer.quoteToken,
                        amount: buyer.amount,
                        price: buyer.price,
                        side: "BUY"
                    },
                    stealthPublicKey: buyer.stealthPublicKey
                },
                seller: {
                    nullifierHash: seller.nullifierHash,
                    orderId: seller.id,
                    order: {
                        asset: seller.asset,
                        quoteToken: seller.quoteToken,
                        amount: seller.amount,
                        price: seller.price,
                        side: "SELL"
                    },
                    stealthPublicKey: seller.stealthPublicKey
                }
            });

            // Update status to SETTLED
            await prisma.$transaction([
                prisma.order.update({
                    where: { id: newOrder.id },
                    data: { status: OrderStatus.SETTLED },
                }),
                prisma.order.update({
                    where: { id: match.id },
                    data: { status: OrderStatus.SETTLED },
                }),
            ]);
            console.log(`[MatchingEngine] Settlement triggered successfully`);


        } catch (error) {
            console.error("[MatchingEngine] Settlement trigger failed:", error);
            // Revert status to OPEN? Or handle manual intervention.
            // For now, keep as MATCHED but log error.
        }
    } else {
        console.log(`[MatchingEngine] No match found for ${newOrder.id}`);
    }
}
