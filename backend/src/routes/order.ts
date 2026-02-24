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
import { NLParserService } from "../services/nl-parser.service";
import { PriceFeedService } from "../services/price-feed.service";
import addresses from "../../addresses.json";


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

// Chain selector mapping
const CHAIN_SELECTOR_MAP: Record<string, string> = {
    'baseSepolia': 'ethereum-testnet-sepolia-base-1',
    'arbitrumSepolia': 'ethereum-testnet-sepolia-arbitrum-1',
};

// ── POST /parse (Parse natural language order message) ──
order.post("/parse", async (c) => {
    const body = await c.req.json<{
        message: string;
        userAddress?: string;
    }>();

    if (!body.message || typeof body.message !== 'string') {
        return c.json({ error: 'Message is required' }, 400);
    }

    const userAddress = (body.userAddress || '').toLowerCase();

    try {
        // Parse the message
        const parsed = await NLParserService.parseOrderMessage(body.message);

        // If not a valid trading request, return parsed result with requiresConfirmation: false
        if (!parsed.isValid) {
            return c.json({
                parsed,
                requiresConfirmation: false,
                balanceCheck: null,
            });
        }

        // Get pair ID for the symbol
        const pair = await prisma.pair.findUnique({
            where: { baseSymbol: parsed.symbol },
        });

        if (!pair) {
            return c.json({
                parsed,
                requiresConfirmation: false,
                balanceCheck: null,
                error: `Trading pair not found for ${parsed.symbol}`,
            });
        }

        // Get chain selector
        const chainSelector = CHAIN_SELECTOR_MAP[parsed.chain];
        const chainConfig = addresses.chains[parsed.chain as keyof typeof addresses.chains];

        // Calculate amount from dollarAmount if provided
        let amount = parsed.amount;
        let price = parsed.price;
        
        if (parsed.dollarAmount && !parsed.amount) {
            // User specified dollar value - need to get price and calculate amount
            let unitPrice: number;
            
            if (parsed.price) {
                // User specified a unit price - use it
                unitPrice = parseFloat(parsed.price);
            } else {
                // No unit price provided - fetch market price
                const priceData = await PriceFeedService.getPriceOrMock(parsed.symbol);
                unitPrice = priceData.price;
                price = priceData.price.toString();
            }
            
            const dollarValue = parseFloat(parsed.dollarAmount);
            amount = (dollarValue / unitPrice).toFixed(6); // Calculate token amount
        }

        // Check balance
        let balanceCheck = {
            hasSufficientBalance: false,
            required: '',
            available: '',
            error: '',
        };

        if (userAddress) {
            if (parsed.side === 'BUY') {
                // Check USDC balance
                const usdcToken = chainConfig?.usdc;
                if (usdcToken) {
                    const tokenBalance = await prisma.tokenBalance.findFirst({
                        where: {
                            userAddress,
                            token: usdcToken.toLowerCase(),
                        },
                    });

                    const availableUSDC = tokenBalance ? parseFloat(tokenBalance.balance) / 1e6 : 0;
                    const totalValue = parseFloat(amount) * parseFloat(price);

                    balanceCheck = {
                        hasSufficientBalance: availableUSDC >= totalValue,
                        required: `${totalValue.toFixed(2)} USDC`,
                        available: `${availableUSDC.toFixed(2)} USDC`,
                        error: availableUSDC >= totalValue ? '' : `Insufficient USDC balance. Need ${totalValue.toFixed(2)} USDC, have ${availableUSDC.toFixed(2)} USDC`,
                    };
                }
            } else if (parsed.side === 'SELL') {
                // Check token balance
                const token = await prisma.token.findFirst({
                    where: {
                        symbol: parsed.symbol,
                        chainSelector,
                    },
                });

                if (token) {
                    const tokenBalance = await prisma.tokenBalance.findFirst({
                        where: {
                            userAddress,
                            token: token.address.toLowerCase(),
                        },
                    });

                    const decimals = token.decimals || 18;
                    const availableToken = tokenBalance ? parseFloat(tokenBalance.balance) / Math.pow(10, decimals) : 0;
                    const requiredToken = parseFloat(amount);

                    balanceCheck = {
                        hasSufficientBalance: availableToken >= requiredToken,
                        required: `${requiredToken.toFixed(4)} ${parsed.symbol}`,
                        available: `${availableToken.toFixed(4)} ${parsed.symbol}`,
                        error: availableToken >= requiredToken ? '' : `Insufficient ${parsed.symbol} balance. Need ${requiredToken.toFixed(4)}, have ${availableToken.toFixed(4)}`,
                    };
                }
            }
        }

        // Calculate total value
        const totalValue = parseFloat(amount) * parseFloat(price);

        return c.json({
            parsed: {
                ...parsed,
                amount,
                price,
                pairId: pair.id,
                chainSelector,
            },
            totalValue: totalValue.toFixed(2),
            requiresConfirmation: true,
            balanceCheck,
        });

    } catch (err: any) {
        console.error('[order/parse] Error:', err);
        return c.json({ error: err.message || 'Failed to parse message' }, 500);
    }
});

// ── POST / (Place Order — unified: create + open + match in one request) ──
order.post("/", authMiddleware, async (c) => {
    console.log('[order] POST /api/order called');
    const body = await c.req.json<OrderInitPayload>();
    const userAddress = (c.get("user") as string).toLowerCase();
    console.log('[order] User:', userAddress, 'Order:', body);

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
    if (Math.round(orderValue * 100) / 100 < 4.99) return c.json({ error: `Minimum order value is 5 USDC (current: ${orderValue.toFixed(2)})` }, 400);

    try {
        const pair = await prisma.pair.findUnique({ where: { id: body.pairId } });
        if (!pair) return c.json({ error: "Invalid pairId: pair not found" }, 400);

        console.log('[order] Creating order for:', userAddress);

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

    } catch (err: any) {
        console.error("[order] Create failed:", err);
        console.error("[order] Error type:", typeof err);
        console.error("[order] Error message:", err?.message);
        console.error("[order] Error code:", err?.code);
        console.error("[order] Error status:", err?.status);
        
        // Check for rate limiting (429)
        if (err.message?.includes('429') || err.message?.includes('rate limit') || err?.status === 429 || err?.code === '429') {
            return c.json({ error: "Too many requests. Please try again in a moment.", detail: String(err) }, 429);
        }
        
        // Check for Prisma errors
        if (err.message?.includes('Prisma') || err.code?.includes('P')) {
            return c.json({ error: "Database error. Please try again.", detail: err.message }, 500);
        }
        
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
