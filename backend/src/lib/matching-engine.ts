import prisma from "../clients/prisma";
import { OrderSide, OrderStatus } from "../../generated/prisma/client";
import { settleMatch } from "./convergence-client";
import { parseUnits } from "ethers";

// Only settle on ETH Sepolia via the Convergence API
const ETH_SEPOLIA_SELECTOR = "ethereum-testnet-sepolia";

// Use 1e18 precision to handle decimal token amounts in BigInt math
function toBigWithPrecision(value: string | number): bigint {
    return BigInt(Math.round(Number(value) * 1e18));
}

function fromBigWithPrecision(value: bigint): number {
    return Number(value) / 1e18;
}

function remaining(order: { amount: string; filledAmount: string }): bigint {
    return toBigWithPrecision(order.amount) - toBigWithPrecision(order.filledAmount);
}

export async function matchOrders(newOrderId: string, onLog?: (log: string) => void) {
    const log = (msg: string) => {
        console.log(`[MatchingEngine] ${msg}`);
        if (onLog) onLog(msg);
    };

    let order = await prisma.order.findUnique({
        where: { id: newOrderId },
        include: { pair: true },
    });

    if (!order || order.status !== OrderStatus.OPEN) return;

    // Only process ETH Sepolia orders — convergence API is single-chain
    if (order.baseChainSelector !== ETH_SEPOLIA_SELECTOR) {
        log(`Order ${order.id} chain "${order.baseChainSelector}" is not ETH Sepolia — skipping`);
        return;
    }

    const { baseSymbol } = order.pair;
    log(`Starting match for order ${order.id} | ${order.side} ${order.amount} ${baseSymbol} @ ${order.price}`);

    while (true) {
        order = await prisma.order.findUnique({
            where: { id: newOrderId },
            include: { pair: true },
        });

        if (!order || order.status !== OrderStatus.OPEN) break;

        const orderRemaining = remaining(order);
        log(`Order remaining: ${fromBigWithPrecision(orderRemaining)}`);
        if (orderRemaining <= 0n) break;

        const oppositeSide = order.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;

        // Match orders in same pair on ETH Sepolia only
        const match = order.side === OrderSide.BUY
            ? await prisma.order.findFirst({
                where: {
                    side: oppositeSide,
                    status: OrderStatus.OPEN,
                    pairId: order.pairId,
                    baseChainSelector: ETH_SEPOLIA_SELECTOR,
                    price: { lte: order.price },
                },
                orderBy: [{ price: 'asc' }, { createdAt: 'asc' }],
            })
            : await prisma.order.findFirst({
                where: {
                    side: oppositeSide,
                    status: OrderStatus.OPEN,
                    pairId: order.pairId,
                    baseChainSelector: ETH_SEPOLIA_SELECTOR,
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

        const tradeAmount        = orderRemaining < matchRemaining ? orderRemaining : matchRemaining;
        const tradeAmountDecimal = fromBigWithPrecision(tradeAmount);

        log(`Match found: ${order.id} <-> ${match.id} (trade: ${tradeAmountDecimal} ${baseSymbol})`);

        const orderNewFilled  = toBigWithPrecision(order.filledAmount) + tradeAmount;
        const matchNewFilled  = toBigWithPrecision(match.filledAmount) + tradeAmount;

        const orderFullyFilled = orderNewFilled >= toBigWithPrecision(order.amount);
        const matchFullyFilled = matchNewFilled >= toBigWithPrecision(match.amount);

        const orderNewFilledDecimal = fromBigWithPrecision(orderNewFilled).toString();
        const matchNewFilledDecimal = fromBigWithPrecision(matchNewFilled).toString();

        const buyer  = order.side === OrderSide.BUY  ? order : match;
        const seller = order.side === OrderSide.SELL ? order : match;

        if (!buyer.userAddress || !seller.userAddress) {
            log(`Skipping match: missing userAddress`);
            break;
        }

        if (!buyer.stealthAddress || !seller.stealthAddress) {
            log(`Skipping match: missing stealthAddress (buyer: ${!!buyer.stealthAddress}, seller: ${!!seller.stealthAddress})`);
            break;
        }

        // Resolve token addresses from DB for ETH Sepolia
        const baseToken = await prisma.token.findFirst({
            where: { symbol: baseSymbol, chainSelector: ETH_SEPOLIA_SELECTOR },
        });
        const quoteToken = await prisma.token.findFirst({
            where: { symbol: 'USDC', chainSelector: ETH_SEPOLIA_SELECTOR },
        });

        if (!baseToken || !quoteToken) {
            log(`Token not found: ${baseSymbol}@${ETH_SEPOLIA_SELECTOR} or USDC@${ETH_SEPOLIA_SELECTOR}`);
            break;
        }

        const price        = Number(match.price);
        const costQuote    = tradeAmountDecimal * price;

        const baseAmountWei  = parseUnits(tradeAmountDecimal.toFixed(baseToken.decimals), baseToken.decimals);
        const quoteAmountWei = parseUnits(costQuote.toFixed(quoteToken.decimals), quoteToken.decimals);

        // ── Update order status in DB (removes orders from book) ──
        await prisma.$transaction([
            prisma.order.update({
                where: { id: order.id },
                data: { filledAmount: orderNewFilledDecimal, status: orderFullyFilled ? OrderStatus.SETTLED : OrderStatus.OPEN },
            }),
            prisma.order.update({
                where: { id: match.id },
                data: { filledAmount: matchNewFilledDecimal, status: matchFullyFilled ? OrderStatus.SETTLED : OrderStatus.OPEN },
            }),
        ]);

        log(`Orders updated in DB. Settling via Convergence API...`);

        // ── Settle via Convergence API private-transfers ──
        try {
            const result = await settleMatch({
                buyerStealthAddress:  buyer.stealthAddress,
                sellerStealthAddress: seller.stealthAddress,
                baseTokenAddress:     baseToken.address,
                quoteTokenAddress:    quoteToken.address,
                baseAmountWei:        baseAmountWei.toString(),
                quoteAmountWei:       quoteAmountWei.toString(),
            }, onLog);

            log(`Convergence settlement complete. Buyer tx: ${result.buyerTxId} | Seller tx: ${result.sellerTxId}`);
        } catch (error) {
            log(`Convergence settlement failed (DB already updated): ${error}`);
        }

        log(`Done. Trade: ${tradeAmountDecimal} ${baseSymbol} @ ${price} USDC`);

        if (orderFullyFilled) break;
    }
}
