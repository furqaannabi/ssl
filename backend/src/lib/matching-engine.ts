import prisma from "../clients/prisma";
import { OrderSide, OrderStatus } from "../../generated/prisma/client";
import { sendToCRE } from "./cre-client";
import { parseUnits } from "ethers";

function remaining(order: { amount: string; filledAmount: string }): bigint {
    return BigInt(Math.floor(Number(order.amount))) - BigInt(Math.floor(Number(order.filledAmount)));
}

export async function matchOrders(newOrderId: string, onLog?: (log: string) => void) {
    const log = (msg: string) => {
        console.log(`[MatchingEngine] ${msg}`);
        if (onLog) onLog(msg);
    };

    // Load order with pair AND tokens (needed for decimals)
    let order = await prisma.order.findUnique({
        where: { id: newOrderId },
        include: { 
            pair: {
                include: {
                    baseToken: true,
                    quoteToken: true
                }
            }
        },
    });

    if (!order || order.status !== OrderStatus.OPEN) {
        return;
    }

    const { baseToken, quoteToken } = order.pair;
    const baseTokenAddress = baseToken.address;
    const quoteTokenAddress = quoteToken.address;

    // Loop: keep matching until fully filled or no more counterparties
    while (true) {
        // Refresh order state
        order = await prisma.order.findUnique({
            where: { id: newOrderId },
            include: { 
                pair: {
                    include: {
                        baseToken: true,
                        quoteToken: true
                    }
                }
            },
        });

        if (!order || order.status !== OrderStatus.OPEN) break;

        const orderRemaining = remaining(order);
        if (orderRemaining <= 0n) break;

        const oppositeSide = order.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;

        // Find match
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
        if (matchRemaining <= 0n) continue;

        // Trade amount (Human Units, integer for now due to BigInt logic above)
        const tradeAmount = orderRemaining < matchRemaining ? orderRemaining : matchRemaining;

        log(`Match found: ${order.id} <-> ${match.id} (trade: ${tradeAmount})`);

        // Compute new filled amounts
        const orderNewFilled = BigInt(Math.floor(Number(order.filledAmount))) + tradeAmount;
        const matchNewFilled = BigInt(Math.floor(Number(match.filledAmount))) + tradeAmount;

        const orderFullyFilled = orderNewFilled >= BigInt(Math.floor(Number(order.amount)));
        const matchFullyFilled = matchNewFilled >= BigInt(Math.floor(Number(match.amount)));

        const buyer = order.side === OrderSide.BUY ? order : match;
        const seller = order.side === OrderSide.SELL ? order : match;

        if (!buyer.userAddress || !seller.userAddress) {
            log(`Skipping match: missing userAddress`);
            break;
        }

        // 1. Calculate Wei Values for Balance Updates
        // Trade Amount (Base Token) -> Wei
        const baseAmountWei = parseUnits(tradeAmount.toString(), baseToken.decimals);
        
        // Quote Amount (Cost) -> Wei
        // Price is per unit. Cost = tradeAmount * price.
        const price = Number(match.price); // Use Maker price
        const costQuote = Number(tradeAmount) * price;
        const quoteAmountWei = parseUnits(costQuote.toFixed(quoteToken.decimals), quoteToken.decimals);

        // Send to CRE (Mock/Sim)
        try {
            await sendToCRE({
                action: "settle_match",
                baseTokenAddress,
                quoteTokenAddress,
                tradeAmount: tradeAmount.toString(),
                buyer: {
                    orderId: buyer.id,
                    stealthAddress: buyer.stealthAddress,
                },
                seller: {
                    orderId: seller.id,
                    stealthAddress: seller.stealthAddress,
                },
            }, onLog);
        } catch (error) {
            console.error("[MatchingEngine] Settlement failed:", error);
            log(`Settlement failed: ${error}`);
            break;
        }

        // DB Updates: Order Status + Balances
        // TODO: This should be a robust transaction. optimizing for simple atomic update here.
        
        // Helper to update balance
        const updateBalance = async (user: string, token: string, delta: bigint) => {
             // We need to fetch current first to do math in JS (Prisma doesn't support atomic increment on string fields easily without raw query)
             // But for safety in this specific prototype, we will trust the read-modify-write within logic or use raw if needed. 
             // Since we need to support any token, we'll try read-modify-write.
             const record = await prisma.tokenBalance.findUnique({
                 where: { userAddress_token: { userAddress: user, token } }
             });
             const current = record ? BigInt(record.balance) : 0n;
             const newVal = current + delta;
             
             return prisma.tokenBalance.upsert({
                 where: { userAddress_token: { userAddress: user, token } },
                 update: { balance: newVal.toString() },
                 create: { userAddress: user, token, balance: newVal.toString() }
             });
        };

        // Buyer: +Base, -Quote
        // Seller: -Base, +Quote
        
        // WE EXECUTE IN SEQUENCE (Ideal would be interactive transaction but limitations apply)
        // We will perform the balance calculations and push them into the $transaction if possible, 
        // OR execute them right before.
        
        // Reading current balances to prepare updates
        const buyerBase = await prisma.tokenBalance.findUnique({ where: { userAddress_token: { userAddress: buyer.userAddress!, token: baseTokenAddress } } });
        const buyerQuote = await prisma.tokenBalance.findUnique({ where: { userAddress_token: { userAddress: buyer.userAddress!, token: quoteTokenAddress } } });
        const sellerBase = await prisma.tokenBalance.findUnique({ where: { userAddress_token: { userAddress: seller.userAddress!, token: baseTokenAddress } } });
        const sellerQuote = await prisma.tokenBalance.findUnique({ where: { userAddress_token: { userAddress: seller.userAddress!, token: quoteTokenAddress } } });

        const buyerBaseBal = buyerBase ? BigInt(buyerBase.balance) : 0n;
        const buyerQuoteBal = buyerQuote ? BigInt(buyerQuote.balance) : 0n;
        const sellerBaseBal = sellerBase ? BigInt(sellerBase.balance) : 0n;
        const sellerQuoteBal = sellerQuote ? BigInt(sellerQuote.balance) : 0n;

        await prisma.$transaction([
            // Update Orders
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
            // Update Balances
            // Buyer: +Base
            prisma.tokenBalance.upsert({
                where: { userAddress_token: { userAddress: buyer.userAddress!, token: baseTokenAddress } },
                update: { balance: (buyerBaseBal + baseAmountWei).toString() },
                create: { userAddress: buyer.userAddress!, token: baseTokenAddress, balance: (baseAmountWei).toString() }
            }),
            // Buyer: -Quote
            prisma.tokenBalance.upsert({
                where: { userAddress_token: { userAddress: buyer.userAddress!, token: quoteTokenAddress } },
                update: { balance: (buyerQuoteBal - quoteAmountWei).toString() },
                create: { userAddress: buyer.userAddress!, token: quoteTokenAddress, balance: (-quoteAmountWei).toString() } // Should not happen ifsolvent
            }),
            // Seller: -Base
            prisma.tokenBalance.upsert({
                where: { userAddress_token: { userAddress: seller.userAddress!, token: baseTokenAddress } },
                update: { balance: (sellerBaseBal - baseAmountWei).toString() },
                create: { userAddress: seller.userAddress!, token: baseTokenAddress, balance: (-baseAmountWei).toString() }
            }),
            // Seller: +Quote
            prisma.tokenBalance.upsert({
                where: { userAddress_token: { userAddress: seller.userAddress!, token: quoteTokenAddress } },
                update: { balance: (sellerQuoteBal + quoteAmountWei).toString() },
                create: { userAddress: seller.userAddress!, token: quoteTokenAddress, balance: (quoteAmountWei).toString() }
            })
        ]);

        log(`Settled and balances updated. Trade: ${tradeAmount} ${baseToken.symbol} @ ${price} ${quoteToken.symbol}`);

        if (orderFullyFilled) break;
    }
}
