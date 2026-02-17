
import prisma from "../clients/prisma";
import { OrderSide, OrderStatus } from "../../generated/prisma/client";
import { sendToCRE } from "./cre-client";

function remaining(order: { amount: string; filledAmount: string }): bigint {
    return BigInt(order.amount) - BigInt(order.filledAmount);
}

export async function matchOrders(newOrderId: string, onLog?: (log: string) => void) {
    const log = (msg: string) => {
        console.log(`[MatchingEngine] ${msg}`);
        if (onLog) onLog(msg);
    };

    // Load order with pair (needed for token addresses)
    let order = await prisma.order.findUnique({
        where: { id: newOrderId },
        include: { pair: true },
    });

    if (!order || order.status !== OrderStatus.OPEN) {
        return;
    }

    const { baseTokenAddress, quoteTokenAddress } = order.pair;

    // Loop: keep matching until fully filled or no more counterparties
    while (true) {
        // Refresh order state (filledAmount may have changed)
        order = await prisma.order.findUnique({
            where: { id: newOrderId },
            include: { pair: true },
        });

        if (!order || order.status !== OrderStatus.OPEN) break;

        const orderRemaining = remaining(order);
        if (orderRemaining <= 0n) break;

        const oppositeSide = order.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;

        // Find best counterparty with remaining amount > 0
        // Buy: lowest sell price <= buy price
        // Sell: highest buy price >= sell price
        const match = order.side === OrderSide.BUY
            ? await prisma.order.findFirst({
                where: {
                    side: oppositeSide,
                    status: OrderStatus.OPEN,
                    pairId: order.pairId,
                    price: { lte: order.price },
                },
                orderBy: [{ price: 'asc' }, { createdAt: 'asc' }],
            })
            : await prisma.order.findFirst({
                where: {
                    side: oppositeSide,
                    status: OrderStatus.OPEN,
                    pairId: order.pairId,
                    price: { gte: order.price },
                },
                orderBy: [{ price: 'desc' }, { createdAt: 'asc' }],
            });

        if (!match) {
            log(`No more matches for order ${order.id} (remaining: ${orderRemaining})`);
            break;
        }

        const matchRemaining = remaining(match);
        if (matchRemaining <= 0n) continue; // skip stale, find next

        // Trade amount = min of both remaining quantities
        const tradeAmount = orderRemaining < matchRemaining ? orderRemaining : matchRemaining;

        log(`Match found: ${order.id} <-> ${match.id} (trade: ${tradeAmount})`);

        // Compute new filled amounts
        const orderNewFilled = BigInt(order.filledAmount) + tradeAmount;
        const matchNewFilled = BigInt(match.filledAmount) + tradeAmount;

        const orderFullyFilled = orderNewFilled >= BigInt(order.amount);
        const matchFullyFilled = matchNewFilled >= BigInt(match.amount);

        // Identify buyer and seller
        const buyer = order.side === OrderSide.BUY ? order : match;
        const seller = order.side === OrderSide.SELL ? order : match;

        if (!buyer.userAddress || !seller.userAddress) {
            log(`Skipping match: missing userAddress`);
            break;
        }

        // Send to CRE for settlement (before updating DB, so failure is safe)
        try {
            await sendToCRE({
                action: "settle_match",
                baseTokenAddress,
                quoteTokenAddress,
                tradeAmount: tradeAmount.toString(),
                buyer: {
                    orderId: buyer.id,
                    order: {
                        pairId: buyer.pairId,
                        amount: buyer.amount,
                        price: buyer.price,
                        side: "BUY"
                    },
                    stealthPublicKey: buyer.stealthPublicKey
                },
                seller: {
                    orderId: seller.id,
                    order: {
                        pairId: seller.pairId,
                        amount: seller.amount,
                        price: seller.price,
                        side: "SELL"
                    },
                    stealthPublicKey: seller.stealthPublicKey
                }
            }, onLog);
        } catch (error) {
            console.error("[MatchingEngine] Settlement failed:", error);
            log(`Settlement failed for ${order.id} <-> ${match.id}: ${error}`);
            break;
        }

        // CRE succeeded -- update filled amounts and statuses
        await prisma.$transaction([
            prisma.order.update({
                where: { id: order.id },
                data: {
                    filledAmount: orderNewFilled.toString(),
                    status: orderFullyFilled ? OrderStatus.SETTLED : OrderStatus.OPEN,
                },
            }),
            prisma.order.update({
                where: { id: match.id },
                data: {
                    filledAmount: matchNewFilled.toString(),
                    status: matchFullyFilled ? OrderStatus.SETTLED : OrderStatus.OPEN,
                },
            }),
        ]);

        log(`Fill settled: ${tradeAmount} units. Order ${order.id}: ${orderNewFilled}/${order.amount}${orderFullyFilled ? ' (SETTLED)' : ''}. Order ${match.id}: ${matchNewFilled}/${match.amount}${matchFullyFilled ? ' (SETTLED)' : ''}`);

        // If our order is fully filled, stop
        if (orderFullyFilled) break;
    }
}
