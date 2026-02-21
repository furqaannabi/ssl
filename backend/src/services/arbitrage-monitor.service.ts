/**
 * Arbitrage Monitor Service
 * Compares SSL order book prices against real market prices
 * Detects opportunities when orders are significantly mispriced
 */

import prisma from '../clients/prisma';
import { PriceFeedService, type PriceData } from './price-feed.service';

export interface ArbitrageOpportunity {
    id: string;
    pairSymbol: string;
    tokenSymbol: string;
    orderPrice: number;
    marketPrice: number;
    profitPercent: number;
    direction: 'BUY' | 'SELL'; // What the user should do to capture the arb
    orderSide: 'BUY' | 'SELL'; // The existing order's side
    orderAmount: number;
    potentialProfit: number;
    detectedAt: number;
}

const ARBITRAGE_THRESHOLD = parseFloat(process.env.ARBITRAGE_THRESHOLD_PERCENT || '2.0');

// In-memory store of active opportunities
let activeOpportunities: ArbitrageOpportunity[] = [];

export class ArbitrageMonitorService {

    static getActiveOpportunities(): ArbitrageOpportunity[] {
        return activeOpportunities;
    }

    static async scan(): Promise<ArbitrageOpportunity[]> {
        try {
            // Get all open orders with their pair info
            const openOrders = await prisma.order.findMany({
                where: { status: 'OPEN' },
                include: { pair: true },
            });

            if (openOrders.length === 0) {
                activeOpportunities = [];
                return [];
            }

            const opportunities: ArbitrageOpportunity[] = [];

            // Group orders by base token symbol
            const ordersByToken = new Map<string, typeof openOrders>();
            for (const order of openOrders) {
                const sym = order.pair.baseSymbol;
                if (!ordersByToken.has(sym)) ordersByToken.set(sym, []);
                ordersByToken.get(sym)!.push(order);
            }

            // Check each token against market price
            for (const [tokenSymbol, orders] of ordersByToken) {
                const priceData = await PriceFeedService.getPriceOrMock(tokenSymbol);
                const marketPrice = priceData.price;
                if (marketPrice <= 0) continue;

                for (const order of orders) {
                    const orderPrice = parseFloat(order.price);
                    const orderAmount = parseFloat(order.amount) - parseFloat(order.filledAmount);
                    if (orderAmount <= 0) continue;

                    let profitPercent = 0;
                    let direction: 'BUY' | 'SELL';

                    if (order.side === 'SELL') {
                        // Sell order below market price = BUY opportunity
                        profitPercent = ((marketPrice - orderPrice) / orderPrice) * 100;
                        direction = 'BUY';
                    } else {
                        // Buy order above market price = SELL opportunity
                        profitPercent = ((orderPrice - marketPrice) / marketPrice) * 100;
                        direction = 'SELL';
                    }

                    if (profitPercent >= ARBITRAGE_THRESHOLD) {
                        const potentialProfit = Math.abs(marketPrice - orderPrice) * orderAmount;
                        opportunities.push({
                            id: `arb-${order.id}`,
                            pairSymbol: `${order.pair.baseSymbol}/USDC`,
                            tokenSymbol,
                            orderPrice,
                            marketPrice,
                            profitPercent: Math.round(profitPercent * 100) / 100,
                            direction,
                            orderSide: order.side as 'BUY' | 'SELL',
                            orderAmount,
                            potentialProfit: Math.round(potentialProfit * 100) / 100,
                            detectedAt: Date.now(),
                        });
                    }
                }
            }

            activeOpportunities = opportunities;
            return opportunities;
        } catch (err) {
            console.error('[ArbitrageMonitor] Scan failed:', err);
            return activeOpportunities; // Return stale data on error
        }
    }

    /** Start background scanning */
    static startMonitor(intervalMs: number = 10_000) {
        console.log(`[ArbitrageMonitor] Starting with ${intervalMs}ms interval, threshold: ${ARBITRAGE_THRESHOLD}%`);
        // Initial scan
        this.scan().catch(console.error);
        // Periodic scan
        setInterval(() => {
            this.scan().catch(console.error);
        }, intervalMs);
    }
}
