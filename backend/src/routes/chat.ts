/**
 * AI Chat Route
 * POST /api/chat — SSE streaming AI financial advisor
 * GET /api/chat/arbitrage — Get current arbitrage opportunities
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { AIAdvisorService, type ChatMessage } from '../services/ai-advisor.service';
import { ArbitrageMonitorService } from '../services/arbitrage-monitor.service';
import { PriceFeedService } from '../services/price-feed.service';
import type { LiveBalance } from '../services/ai-context.service';

const chat = new Hono();

// POST /api/chat — Stream AI response
chat.post('/', async (c) => {
    const body = await c.req.json<{
        message: string;
        conversationHistory?: ChatMessage[];
        userAddress?: string;
        // Live balances from the frontend — ephemeral, never persisted, used only for this response
        portfolioBalances?: LiveBalance[];
    }>();

    if (!body.message || typeof body.message !== 'string') {
        return c.json({ error: 'Message is required' }, 400);
    }

    const userAddress = body.userAddress || 'anonymous';
    const history = body.conversationHistory || [];
    const liveBalances = body.portfolioBalances;

    return streamSSE(c, async (stream) => {
        let fullResponse = '';

        for await (const chunk of AIAdvisorService.streamChat(userAddress, body.message, history, liveBalances)) {
            fullResponse += chunk;
            await stream.writeSSE({
                data: JSON.stringify({ type: 'chunk', content: chunk }),
            });
        }

        // Send final message
        await stream.writeSSE({
            data: JSON.stringify({ type: 'done', content: fullResponse }),
        });
    });
});

// GET /api/chat/arbitrage — Get current arbitrage opportunities
chat.get('/arbitrage', async (c) => {
    const opportunities = ArbitrageMonitorService.getActiveOpportunities();
    return c.json({ success: true, opportunities });
});

// GET /api/chat/prices — Get all current prices
chat.get('/prices', async (c) => {
    const prices = await PriceFeedService.getAllPricesOrMock();
    return c.json({ success: true, prices });
});

// GET /api/chat/prices/:symbol — Get single token price
chat.get('/prices/:symbol', async (c) => {
    const symbol = c.req.param('symbol');
    const price = await PriceFeedService.getPriceOrMock(symbol);
    return c.json({ success: true, price });
});

export { chat };
