/**
 * AI Context Builder
 * Builds dynamic context for the AI advisor based on user portfolio,
 * market data, order book, and arbitrage opportunities
 */

import prisma from '../clients/prisma';
import { PriceFeedService } from './price-feed.service';
import { ArbitrageMonitorService } from './arbitrage-monitor.service';


/** Shape of a live balance entry forwarded from the frontend (Convergence API response) */
export interface LiveBalance {
    token: string;       // contract address
    symbol: string;      // e.g. "tNVDA"
    balance: number;     // already in human-readable units
}

export class AIContextService {
    static async buildContext(userAddress: string, liveBalances?: LiveBalance[]): Promise<string> {
        // Normalise — auth stores addresses lowercase; wagmi sends checksummed mixed-case
        const address = userAddress.toLowerCase();
        const sections: string[] = [];

        // 1. User Portfolio
        // If the frontend passed live (signed) balances, use those — no DB read, preserving privacy.
        // Otherwise fall back to the local DB (which may be empty).
        if (liveBalances && liveBalances.length > 0) {
            const portfolioLines: string[] = [];
            let totalValue = 0;

            for (const bal of liveBalances) {
                if (bal.balance <= 0) continue;

                const isUSDC = bal.symbol.toLowerCase().includes('usdc');
                let priceObj = { price: 1.0, changePercent: 0 };

                if (!isUSDC) {
                    try {
                        priceObj = await PriceFeedService.getPriceOrMock(bal.symbol);
                    } catch {
                        continue;
                    }
                }

                const value = bal.balance * priceObj.price;
                totalValue += value;

                portfolioLines.push(
                    `  - ${bal.balance.toFixed(4)} ${bal.symbol} @ $${priceObj.price.toFixed(2)} = $${value.toFixed(2)}${!isUSDC ? ` (${priceObj.changePercent >= 0 ? '+' : ''}${priceObj.changePercent.toFixed(2)}% today)` : ''}`
                );
            }

            if (portfolioLines.length > 0) {
                sections.push(`USER PORTFOLIO (Total: ~$${totalValue.toFixed(2)}):\n${portfolioLines.join('\n')}`);
            } else {
                sections.push('USER PORTFOLIO: No holdings with positive balance.');
            }
        } else {
            // Fallback: try DB (likely empty — user should sync from chat)
            try {
                const dbBalances = await prisma.tokenBalance.findMany({ where: { userAddress: address } });
                if (dbBalances.length > 0) {
                    const portfolioLines: string[] = [];
                    let totalValue = 0;

                    for (const bal of dbBalances) {
                        const token = await prisma.token.findUnique({ where: { address: bal.token } });
                        const symbol = token?.symbol || bal.token.slice(0, 8);
                        const decimals = token?.decimals || 18;
                        const humanBalance = parseFloat(bal.balance) / (10 ** decimals);
                        if (humanBalance <= 0) continue;

                        const isUSDC = symbol.toLowerCase().includes('usdc');
                        let priceObj = { price: 1.0, changePercent: 0 };
                        if (!isUSDC) {
                            try { priceObj = await PriceFeedService.getPriceOrMock(symbol); } catch { continue; }
                        }
                        const value = humanBalance * priceObj.price;
                        totalValue += value;
                        portfolioLines.push(
                            `  - ${humanBalance.toFixed(4)} ${symbol} @ $${priceObj.price.toFixed(2)} = $${value.toFixed(2)}`
                        );
                    }

                    sections.push(portfolioLines.length > 0
                        ? `USER PORTFOLIO (Total: ~$${totalValue.toFixed(2)}):\n${portfolioLines.join('\n')}`
                        : 'USER PORTFOLIO: No holdings. Use the "Sync Portfolio" button in this chat to share your live balances.'
                    );
                } else {
                    sections.push('USER PORTFOLIO: Not synced. Use the "Sync Portfolio" button in this chat to let me see your holdings.');
                }
            } catch {
                sections.push('USER PORTFOLIO: Unable to fetch.');
            }
        }


        // 2. Market Prices
        try {
            const prices = await PriceFeedService.getAllPricesOrMock();
            const priceLines = Object.values(prices).map(p =>
                `  - ${p.symbol} (${p.realSymbol}): $${p.price.toFixed(2)} ${p.changePercent >= 0 ? '+' : ''}${p.changePercent.toFixed(2)}%`
            );
            sections.push(`MARKET PRICES:\n${priceLines.join('\n')}`);
        } catch (err) {
            sections.push('MARKET PRICES: Unable to fetch.');
        }

        // 3. Active Arbitrage Opportunities
        try {
            const opportunities = ArbitrageMonitorService.getActiveOpportunities();
            if (opportunities.length > 0) {
                const arbLines = opportunities.map(o =>
                    `  - ${o.direction} ${o.pairSymbol}: Order @ $${o.orderPrice.toFixed(2)} vs Market $${o.marketPrice.toFixed(2)} → ${o.profitPercent.toFixed(1)}% profit (~$${o.potentialProfit.toFixed(2)} on ${o.orderAmount} units)`
                );
                sections.push(`ARBITRAGE OPPORTUNITIES (${opportunities.length} active):\n${arbLines.join('\n')}`);
            } else {
                sections.push('ARBITRAGE OPPORTUNITIES: None detected at current threshold.');
            }
        } catch (err) {
            sections.push('ARBITRAGE OPPORTUNITIES: Unable to scan.');
        }

        // 4. Recent Order Book Activity
        try {
            const recentOrders = await prisma.order.findMany({
                where: { status: 'OPEN' },
                include: { pair: true },
                take: 10,
                orderBy: { createdAt: 'desc' },
            });

            if (recentOrders.length > 0) {
                const bookLines = recentOrders.map(o => {
                    const remaining = parseFloat(o.amount) - parseFloat(o.filledAmount);
                    return `  - ${o.side} ${remaining.toFixed(2)} ${o.pair.baseSymbol} @ $${parseFloat(o.price).toFixed(2)}`;
                });
                sections.push(`ORDER BOOK (top ${recentOrders.length} open):\n${bookLines.join('\n')}`);
            }
        } catch (err) {
            // Skip order book on error
        }

        // 5. Platform info
        sections.push(`PLATFORM INFO:
  - Platform: SSL (Stealth Settlement Layer) — private RWA trading with stealth addresses
  - Chain: Ethereum Sepolia (single-chain)
  - Tokens: Only whitelisted RWA tokens (stocks, ETFs, bonds) can be traded
  - Settlement: Orders are matched off-chain and settled on-chain via stealth addresses
  - Users can deposit, trade, and withdraw whitelisted tokens`);

        return sections.join('\n\n');
    }
}
