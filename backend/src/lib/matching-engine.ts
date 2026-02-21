import prisma from "../clients/prisma";
import { OrderSide, OrderStatus } from "../../generated/prisma/client";
import { sendToCRE } from "./cre-client";
import type { MatchPayload } from "./cre-client";
import { config } from "./config";
import { parseUnits } from "ethers";

function remaining(order: { amount: string; filledAmount: string }): bigint {
    return BigInt(Math.floor(Number(order.amount))) - BigInt(Math.floor(Number(order.filledAmount)));
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

    const { baseSymbol } = order.pair;

    while (true) {
        order = await prisma.order.findUnique({
            where: { id: newOrderId },
            include: { pair: true },
        });

        if (!order || order.status !== OrderStatus.OPEN) break;

        const orderRemaining = remaining(order);
        if (orderRemaining <= 0n) break;

        const oppositeSide = order.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;

        // Match orders in same pair on same baseChain (RWA must be on same chain)
        const match = order.side === OrderSide.BUY
            ? await prisma.order.findFirst({
                where: {
                    side: oppositeSide,
                    status: OrderStatus.OPEN,
                    pairId: order.pairId,
                    baseChainSelector: order.baseChainSelector,
                    price: { lte: order.price },
                },
                orderBy: [{ price: 'asc' }, { createdAt: 'asc' }],
            })
            : await prisma.order.findFirst({
                where: {
                    side: oppositeSide,
                    status: OrderStatus.OPEN,
                    pairId: order.pairId,
                    baseChainSelector: order.baseChainSelector,
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

        const tradeAmount = orderRemaining < matchRemaining ? orderRemaining : matchRemaining;

        log(`Match found: ${order.id} <-> ${match.id} (trade: ${tradeAmount})`);

        const orderNewFilled = BigInt(Math.floor(Number(order.filledAmount))) + tradeAmount;
        const matchNewFilled = BigInt(Math.floor(Number(match.filledAmount))) + tradeAmount;

        const orderFullyFilled = orderNewFilled >= BigInt(Math.floor(Number(order.amount)));
        const matchFullyFilled = matchNewFilled >= BigInt(Math.floor(Number(match.amount)));

        const buyer  = order.side === OrderSide.BUY  ? order : match;
        const seller = order.side === OrderSide.SELL ? order : match;

        if (!buyer.userAddress || !seller.userAddress) {
            log(`Skipping match: missing userAddress`);
            break;
        }

        // Resolve token addresses from DB using chain selectors
        const baseToken = await prisma.token.findFirst({
            where: { symbol: baseSymbol, chainSelector: buyer.baseChainSelector },
        });
        const quoteToken = await prisma.token.findFirst({
            where: { symbol: 'USDC', chainSelector: buyer.quoteChainSelector },
        });

        if (!baseToken || !quoteToken) {
            log(`Token not found: ${baseSymbol}@${buyer.baseChainSelector} or USDC@${buyer.quoteChainSelector}`);
            break;
        }

        const price = Number(match.price);
        const costQuote = Number(tradeAmount) * price;

        const baseAmountWei  = parseUnits(tradeAmount.toString(), baseToken.decimals);
        const quoteAmountWei = parseUnits(costQuote.toFixed(quoteToken.decimals), quoteToken.decimals);

        // Cross-chain: buyer's USDC is on a different chain than the RWA
        const isCrossChain = buyer.quoteChainSelector !== buyer.baseChainSelector;

        const crePayload: MatchPayload = {
            action: "settle_match",
            baseTokenAddress:  baseToken.address,
            quoteTokenAddress: quoteToken.address,
            tradeAmount:       baseAmountWei.toString(),
            quoteAmount:       quoteAmountWei.toString(),
            baseChainSelector: buyer.baseChainSelector,
            buyer: {
                orderId: buyer.id,
                stealthAddress: buyer.stealthAddress,
            },
            seller: {
                orderId: seller.id,
                stealthAddress: seller.stealthAddress,
            },
        };

        if (isCrossChain) {
            const destChainCfg = Object.values(config.chains).find(
                c => c.chainSelector === buyer.baseChainSelector
            );
            crePayload.crossChain          = true;
            crePayload.sourceChainSelector = buyer.quoteChainSelector; // USDC chain
            crePayload.destChainSelector   = buyer.baseChainSelector;  // RWA chain
            crePayload.ccipDestSelector    = destChainCfg?.ccipChainSelector || "";

            log(`Cross-chain: USDC from ${buyer.quoteChainSelector} → RWA on ${buyer.baseChainSelector}`);
        }

        try {
            await sendToCRE(crePayload, onLog);
        } catch (error) {
            log(`Settlement failed: ${error}`);
            break;
        }

        // DB balance updates
        const baseChain  = buyer.baseChainSelector;
        const quoteChain = buyer.quoteChainSelector;

        const findBal = (user: string, token: string, chain: string) =>
            prisma.tokenBalance.findUnique({
                where: { userAddress_token_chainSelector: { userAddress: user, token, chainSelector: chain } }
            });

        const buyerBaseBal  = BigInt((await findBal(buyer.userAddress!, baseToken.address, baseChain))?.balance  ?? "0");
        const buyerQuoteBal = BigInt((await findBal(buyer.userAddress!, quoteToken.address, quoteChain))?.balance ?? "0");
        const sellerBaseBal = BigInt((await findBal(seller.userAddress!, baseToken.address, baseChain))?.balance  ?? "0");
        const sellerQuoteBal = BigInt((await findBal(seller.userAddress!, quoteToken.address, quoteChain))?.balance ?? "0");

        await prisma.$transaction([
            prisma.order.update({
                where: { id: order.id },
                data: { filledAmount: orderNewFilled.toString(), status: orderFullyFilled ? OrderStatus.SETTLED : OrderStatus.OPEN },
            }),
            prisma.order.update({
                where: { id: match.id },
                data: { filledAmount: matchNewFilled.toString(), status: matchFullyFilled ? OrderStatus.SETTLED : OrderStatus.OPEN },
            }),
            prisma.tokenBalance.upsert({
                where: { userAddress_token_chainSelector: { userAddress: buyer.userAddress!, token: baseToken.address, chainSelector: baseChain } },
                update: { balance: (buyerBaseBal + baseAmountWei).toString() },
                create: { userAddress: buyer.userAddress!, token: baseToken.address, chainSelector: baseChain, balance: baseAmountWei.toString() },
            }),
            prisma.tokenBalance.upsert({
                where: { userAddress_token_chainSelector: { userAddress: buyer.userAddress!, token: quoteToken.address, chainSelector: quoteChain } },
                update: { balance: (buyerQuoteBal - quoteAmountWei).toString() },
                create: { userAddress: buyer.userAddress!, token: quoteToken.address, chainSelector: quoteChain, balance: (-quoteAmountWei).toString() },
            }),
            prisma.tokenBalance.upsert({
                where: { userAddress_token_chainSelector: { userAddress: seller.userAddress!, token: baseToken.address, chainSelector: baseChain } },
                update: { balance: (sellerBaseBal - baseAmountWei).toString() },
                create: { userAddress: seller.userAddress!, token: baseToken.address, chainSelector: baseChain, balance: (-baseAmountWei).toString() },
            }),
            prisma.tokenBalance.upsert({
                where: { userAddress_token_chainSelector: { userAddress: seller.userAddress!, token: quoteToken.address, chainSelector: quoteChain } },
                update: { balance: (sellerQuoteBal + quoteAmountWei).toString() },
                create: { userAddress: seller.userAddress!, token: quoteToken.address, chainSelector: quoteChain, balance: quoteAmountWei.toString() },
            }),
        ]);

        log(`Settled. Trade: ${tradeAmount} ${baseSymbol} @ ${price} USDC | base: ${baseChain} | quote: ${quoteChain}`);

        if (orderFullyFilled) break;
    }
}
