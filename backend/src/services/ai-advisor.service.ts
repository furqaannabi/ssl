/**
 * AI Advisor Service
 * Integrates with OpenAI GPT-4o for financial advice
 * Uses streaming for real-time responses
 */

import OpenAI from 'openai';
import { AIContextService } from './ai-context.service';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});

const AI_MODEL = process.env.AI_MODEL || 'gpt-4o';

const SYSTEM_PROMPT = `You are the SSL Financial Advisor — an AI assistant embedded in the Stealth Settlement Layer (SSL) platform, a private cross-chain trading platform for tokenized Real World Assets (RWA).

Your role:
- Help users understand their portfolio, market conditions, and trading opportunities
- Detect and explain arbitrage opportunities (when order book prices differ from real market prices)
- Provide actionable financial insights based on real-time data
- Guide users on how to use the platform (deposit, trade, withdraw)
- Be concise, data-driven, and use specific numbers from the context provided

Style:
- Use a professional but approachable tone
- Format prices as $XXX.XX
- Use percentages for changes
- When suggesting trades, always mention the specific price, amount, and potential profit/loss
- Never guarantee returns — always note that past performance doesn't guarantee future results
- Keep responses concise (2-4 paragraphs max unless user asks for detail)

Available tokens on SSL: tMETA (Meta), tGOOGL (Alphabet), tAAPL (Apple), tTSLA (Tesla), tAMZN (Amazon), tNVDA (NVIDIA), tSPY (S&P 500 ETF), tQQQ (Nasdaq 100 ETF), tBOND (Treasury Bond), USDC (stablecoin)

When you detect arbitrage opportunities in the context, proactively mention them.
When the user asks about a specific stock, provide the current price and any relevant order book data.`;

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export class AIAdvisorService {
    /**
     * Get a streaming chat completion
     * Returns an async iterable of text chunks
     */
    static async *streamChat(
        userAddress: string,
        userMessage: string,
        conversationHistory: ChatMessage[] = []
    ): AsyncGenerator<string> {
        // Build dynamic context
        const context = await AIContextService.buildContext(userAddress);

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'system', content: `Current market context for this user:\n\n${context}` },
            // Include conversation history (last 10 messages)
            ...conversationHistory.slice(-10).map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            })),
            { role: 'user', content: userMessage },
        ];

        try {
            const stream = await openai.chat.completions.create({
                model: AI_MODEL,
                messages,
                stream: true,
                temperature: 0.7,
                max_tokens: 1024,
            });

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content;
                if (content) {
                    yield content;
                }
            }
        } catch (err: any) {
            if (err.status === 401) {
                yield 'AI service is not configured. Please set a valid OPENAI_API_KEY in the backend environment.';
            } else {
                console.error('[AIAdvisor] Stream error:', err);
                yield 'Sorry, I encountered an error processing your request. Please try again.';
            }
        }
    }

    /**
     * Non-streaming version for simple queries
     */
    static async chat(
        userAddress: string,
        userMessage: string,
        conversationHistory: ChatMessage[] = []
    ): Promise<string> {
        const chunks: string[] = [];
        for await (const chunk of this.streamChat(userAddress, userMessage, conversationHistory)) {
            chunks.push(chunk);
        }
        return chunks.join('');
    }
}
