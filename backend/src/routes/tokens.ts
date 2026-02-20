/**
 * Token Routes
 * GET /api/tokens — List all whitelisted tokens with prices
 * GET /api/tokens/prices/all — Get all RWA prices (no DB)
 * GET /api/tokens/prices/:symbol — Get single RWA price (no DB)
 * GET /api/tokens/:symbol — Get single token with price
 */

import { Hono } from 'hono';
import prisma from '../clients/prisma';
import { PriceFeedService } from '../services/price-feed.service';

const tokens = new Hono();

// RWA token metadata for known tokens
const RWA_TOKEN_META: Record<string, { type: string; realSymbol: string; description: string }> = {
    'tMETA': { type: 'STOCK', realSymbol: 'META', description: 'Meta Platforms Inc.' },
    'tGOOGL': { type: 'STOCK', realSymbol: 'GOOGL', description: 'Alphabet Inc.' },
    'tAAPL': { type: 'STOCK', realSymbol: 'AAPL', description: 'Apple Inc.' },
    'tTSLA': { type: 'STOCK', realSymbol: 'TSLA', description: 'Tesla Inc.' },
    'tAMZN': { type: 'STOCK', realSymbol: 'AMZN', description: 'Amazon.com Inc.' },
    'tNVDA': { type: 'STOCK', realSymbol: 'NVDA', description: 'NVIDIA Corporation' },
    'tSPY': { type: 'ETF', realSymbol: 'SPY', description: 'S&P 500 ETF Trust' },
    'tQQQ': { type: 'ETF', realSymbol: 'QQQ', description: 'Invesco QQQ Trust (Nasdaq 100)' },
    'tBOND': { type: 'BOND', realSymbol: 'TLT', description: 'US Treasury Bond (20+ Year)' },
    'BOND': { type: 'BOND', realSymbol: 'TLT', description: 'SSL Tokenized Bond' },
    'USDC': { type: 'STABLE', realSymbol: 'USDC', description: 'USD Coin' },
    'mUSDC': { type: 'STABLE', realSymbol: 'USDC', description: 'Mock USD Coin' },
};

// GET /api/tokens — List all tokens with prices
tokens.get('/', async (c) => {
    try {
        const dbTokens = await prisma.token.findMany();
        const prices = await PriceFeedService.getAllPricesOrMock();

        const enriched = dbTokens.map(t => {
            const meta = RWA_TOKEN_META[t.symbol];
            const price = prices[t.symbol];
            return {
                ...t,
                tokenType: meta?.type || 'UNKNOWN',
                realSymbol: meta?.realSymbol || t.symbol,
                description: meta?.description || t.name,
                price: price ? {
                    current: price.price,
                    change: price.change,
                    changePercent: price.changePercent,
                    high: price.high,
                    low: price.low,
                } : null,
            };
        });

        return c.json({ success: true, tokens: enriched });
    } catch (err) {
        console.error('[tokens] Fetch failed:', err);
        return c.json({ error: 'Failed to fetch tokens' }, 500);
    }
});

// GET /api/tokens/prices/all — Get all RWA prices (no DB dependency)
// Must be registered BEFORE /:symbol to avoid "prices" matching as a symbol
tokens.get('/prices/all', async (c) => {
    try {
        const prices = await PriceFeedService.getAllPricesOrMock();
        const result = Object.entries(prices).map(([symbol, p]) => {
            const meta = RWA_TOKEN_META[symbol];
            return {
                symbol,
                realSymbol: meta?.realSymbol || symbol,
                name: meta?.description || symbol,
                type: meta?.type || 'UNKNOWN',
                price: p.price,
                change: p.change,
                changePercent: p.changePercent,
                high: p.high,
                low: p.low,
                open: p.open,
                previousClose: p.previousClose,
                timestamp: p.timestamp,
            };
        });
        return c.json({ success: true, prices: result });
    } catch (err) {
        console.error('[tokens] Prices fetch failed:', err);
        return c.json({ error: 'Failed to fetch prices' }, 500);
    }
});

// GET /api/tokens/prices/:symbol — Get single RWA price (no DB dependency)
tokens.get('/prices/:symbol', async (c) => {
    const symbol = c.req.param('symbol');
    try {
        const p = await PriceFeedService.getPriceOrMock(symbol);
        const meta = RWA_TOKEN_META[symbol];
        return c.json({
            success: true,
            price: {
                symbol,
                realSymbol: meta?.realSymbol || symbol,
                name: meta?.description || symbol,
                type: meta?.type || 'UNKNOWN',
                price: p.price,
                change: p.change,
                changePercent: p.changePercent,
                high: p.high,
                low: p.low,
                open: p.open,
                previousClose: p.previousClose,
                timestamp: p.timestamp,
            },
        });
    } catch (err) {
        console.error('[tokens] Price fetch failed:', err);
        return c.json({ error: 'Failed to fetch price' }, 500);
    }
});

// GET /api/tokens/:symbol — Get single token with price (DB lookup)
tokens.get('/:symbol', async (c) => {
    const symbol = c.req.param('symbol');
    try {
        const token = await prisma.token.findFirst({
            where: { symbol: { equals: symbol, mode: 'insensitive' } },
        });

        if (!token) {
            return c.json({ error: 'Token not found' }, 404);
        }

        const meta = RWA_TOKEN_META[token.symbol];
        const price = await PriceFeedService.getPriceOrMock(token.symbol);

        return c.json({
            success: true,
            token: {
                ...token,
                tokenType: meta?.type || 'UNKNOWN',
                realSymbol: meta?.realSymbol || token.symbol,
                description: meta?.description || token.name,
                price: price ? {
                    current: price.price,
                    change: price.change,
                    changePercent: price.changePercent,
                    high: price.high,
                    low: price.low,
                } : null,
            },
        });
    } catch (err) {
        console.error('[tokens] Fetch single failed:', err);
        return c.json({ error: 'Failed to fetch token' }, 500);
    }
});

export { tokens };
