import prisma from "../clients/prisma";
import { OrderSide, OrderStatus } from "../../generated/prisma/client";
import { sendToCRE } from "./cre-client";
import type { MatchPayload } from "./cre-client";
import { config } from "./config";
import { parseUnits } from "ethers";

// Use 1e18 precision to handle decimal token amounts in BigInt math
const PRECISION = 10n ** 18n;

function toBigWithPrecision(value: string | number): bigint {
    return BigInt(Math.round(Number(value) * 1e18));
}

function fromBigWithPrecision(value: bigint): number {
    return Number(value) / 1e18;
}

function remaining(order: { amount: string; filledAmount: string }): bigint {
    return toBigWithPrecision(order.amount) - toBigWithPrecision(order.filledAmount);
}

/** Extract the JSON result object from CRE output (handles both simulate and production modes) */
function extractCREResult(rawResult: any): Record<string, any> | null {
    // Production: result is the direct return value from the workflow
    if (rawResult && typeof rawResult === 'object' && !('output' in rawResult)) return rawResult;

    // Simulate: result is { output: <stdout string> }
    // The CRE CLI outputs: Workflow Simulation Result: "{\"status\":...}"
    if (rawResult?.output && typeof rawResult.output === 'string') {
        const output = rawResult.output as string;

        // Try to find "Workflow Simulation Result: <json-string>" pattern
        const simResultMatch = output.match(/Workflow Simulation Result:\s*"((?:[^"\\]|\\.)*)"/);
        if (simResultMatch) {
            try {
                // The captured group is an escaped JSON string — unescape and parse
                const unescaped = simResultMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                const parsed = JSON.parse(unescaped);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch { /* ignore */ }
        }

        // Fallback: scan lines for a bare JSON object
        const lines = output.split('\n').reverse();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('{')) continue;
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch { /* not valid JSON */ }
        }
    }
    return null;
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
    log(`Starting match for order ${order.id} | ${order.side} ${order.amount} ${baseSymbol} @ ${order.price} | chain: ${order.baseChainSelector}`);

    while (true) {
        order = await prisma.order.findUnique({
            where: { id: newOrderId },
            include: { pair: true },
        });

        if (!order || order.status !== OrderStatus.OPEN) break;

        const orderRemaining = remaining(order);
        log(`Order remaining: ${fromBigWithPrecision(orderRemaining)} (raw: ${orderRemaining})`);
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
        const tradeAmountDecimal = fromBigWithPrecision(tradeAmount);

        log(`Match found: ${order.id} <-> ${match.id} (trade: ${tradeAmountDecimal} ${baseSymbol})`);

        const orderNewFilled = toBigWithPrecision(order.filledAmount) + tradeAmount;
        const matchNewFilled = toBigWithPrecision(match.filledAmount) + tradeAmount;

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
        const costQuote = tradeAmountDecimal * price;

        const baseAmountWei  = parseUnits(tradeAmountDecimal.toFixed(baseToken.decimals), baseToken.decimals);
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

            if (!destChainCfg) {
                log(`Cross-chain order but dest chain config not found for selector: "${buyer.baseChainSelector}" — available: ${Object.values(config.chains).map(c => c.chainSelector).join(', ')}`);
                log(`Falling back to same-chain settlement`);
            } else {
                crePayload.crossChain          = true;
                crePayload.sourceChainSelector = buyer.quoteChainSelector; // USDC chain
                crePayload.destChainSelector   = buyer.baseChainSelector;  // RWA chain
                crePayload.ccipDestSelector    = destChainCfg.ccipChainSelector;

                log(`Cross-chain: USDC from ${buyer.quoteChainSelector} → RWA on ${buyer.baseChainSelector} (CCIP selector: ${destChainCfg.ccipChainSelector})`);
            }
        }

        // ── Settle in DB first (removes orders from book immediately) ──
        const baseChain  = buyer.baseChainSelector;
        const quoteChain = buyer.quoteChainSelector;

        const findBal = (user: string, token: string, chain: string) =>
            prisma.tokenBalance.findUnique({
                where: { userAddress_token_chainSelector: { userAddress: user, token, chainSelector: chain } }
            });

        const buyerBaseBal   = BigInt((await findBal(buyer.userAddress!, baseToken.address, baseChain))?.balance  ?? "0");
        const buyerQuoteBal  = BigInt((await findBal(buyer.userAddress!, quoteToken.address, quoteChain))?.balance ?? "0");
        const sellerBaseBal  = BigInt((await findBal(seller.userAddress!, baseToken.address, baseChain))?.balance  ?? "0");
        const sellerQuoteBal = BigInt((await findBal(seller.userAddress!, quoteToken.address, quoteChain))?.balance ?? "0");

        await prisma.$transaction([
            prisma.order.update({
                where: { id: order.id },
                data: { filledAmount: orderNewFilledDecimal, status: orderFullyFilled ? OrderStatus.SETTLED : OrderStatus.OPEN },
            }),
            prisma.order.update({
                where: { id: match.id },
                data: { filledAmount: matchNewFilledDecimal, status: matchFullyFilled ? OrderStatus.SETTLED : OrderStatus.OPEN },
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

        log(`Orders settled in DB. Triggering CRE for on-chain settlement...`);

        // ── Call CRE for on-chain settlement ──
        try {
            const rawResult = await sendToCRE(crePayload, onLog);
            const result = extractCREResult(rawResult);

            log(`CRE settlement complete. Status: ${result?.status ?? 'unknown'}`);

            // For cross-chain orders, store the bridge tx hash so we can show CCIP explorer link
            if (isCrossChain && result?.bridgeTxHash) {
                const bridgeTxHash = result.bridgeTxHash as string;
                log(`Cross-chain bridge tx: ${bridgeTxHash}`);

                await prisma.$transaction([
                    prisma.order.update({
                        where: { id: order.id },
                        data: { bridgeTxHash },
                    }),
                    prisma.order.update({
                        where: { id: match.id },
                        data: { bridgeTxHash },
                    }),
                ]);
            }
        } catch (error) {
            log(`CRE settlement failed (DB already updated): ${error}`);
            // Orders are already SETTLED in DB; on-chain delivery may be retried manually
        }

        log(`Done. Trade: ${tradeAmountDecimal} ${baseSymbol} @ ${price} USDC | base: ${baseChain} | quote: ${quoteChain}`);

        if (orderFullyFilled) break;
    }
}
