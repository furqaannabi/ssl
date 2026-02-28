/**
 * Natural Language Parser Service
 * Parses user messages like "Buy 0.5 tNVDA at $800" into structured order objects.
 * Supports conversation history for context-aware parsing (e.g. "buy the one we discussed").
 */

import openai, { AI_MODEL } from '../clients/openai';

const VALID_SYMBOLS = ['tMETA', 'tGOOGL', 'tAAPL', 'tTSLA', 'tAMZN', 'tNVDA', 'tSPY', 'tQQQ', 'tBOND'];

const PARSE_SYSTEM_PROMPT = `You are a trading order parser for the SSL (Stealth Settlement Layer) platform.

Your job is to extract structured order information from natural language messages.
Use the conversation history to resolve missing details — e.g. if the user says "buy the tMETA" or "buy it" and earlier messages mentioned tMETA, use that.

VALID TOKENS: tMETA, tGOOGL, tAAPL, tTSLA, tAMZN, tNVDA, tSPY, tQQQ, tBOND (tokenized stocks/ETFs)

INSTRUCTIONS:
1. Extract from the user's latest message (using history for context if needed):
   - side: "BUY" or "SELL" (or null if not specified)
   - amount: token quantity (e.g. "0.5", "10") — only when user specifies a count like "0.5 tNVDA"
   - price: price per unit in USD — use when user says "at $800" or "for $800 each"
   - dollarAmount: total dollar value — use when user says "Buy $800 of tNVDA"
   - symbol: token symbol (e.g. "tNVDA", "tAAPL") — resolve from history if the user says "it", "that one", "the one we discussed", "the token on sale", etc.
   - chain: always return empty string "" — the platform is single-chain Ethereum Sepolia

2. If user does NOT specify a side, return side as null
3. If user does NOT specify an amount or price, return them as empty strings
4. Never set both amount AND dollarAmount — pick the clearest one
5. Return ONLY a JSON object:
   { "side": "BUY"|"SELL"|null, "amount": string, "price": string, "dollarAmount": string, "symbol": string, "chain": string }

EXAMPLES:
- "Buy 0.5 tNVDA at $800" → { "side": "BUY", "amount": "0.5", "price": "800", "dollarAmount": "", "symbol": "tNVDA", "chain": "" }
- "Buy $800 of tNVDA" → { "side": "BUY", "amount": "", "price": "", "dollarAmount": "800", "symbol": "tNVDA", "chain": "" }
- "Sell 10 tAAPL" → { "side": "SELL", "amount": "10", "price": "", "dollarAmount": "", "symbol": "tAAPL", "chain": "" }
- "Buy tGOOGL" → { "side": "BUY", "amount": "", "price": "", "dollarAmount": "", "symbol": "tGOOGL", "chain": "" }
- "buy it at market" (previous context: discussing tMETA) → { "side": "BUY", "amount": "", "price": "", "dollarAmount": "", "symbol": "tMETA", "chain": "" }

Respond with ONLY the JSON object, no additional text.`;

export interface ParsedOrder {
    side: 'BUY' | 'SELL' | null;
    amount: string;
    price: string;
    dollarAmount: string;   // For "Buy $800 of tNVDA" style orders
    symbol: string;
    chain: string;
    isValid: boolean;
    error?: string;
}

/**
 * Regex-based fast parser — no LLM needed, works offline.
 * Handles explicit patterns like "Buy 0.5 tNVDA at $800".
 */
function regexParse(message: string): Partial<ParsedOrder> {
    const lower = message.toLowerCase();

    const side: 'BUY' | 'SELL' | null =
        /\b(buy|purchase|long|acquire|get)\b/.test(lower) ? 'BUY' :
        /\b(sell|short|dispose|drop)\b/.test(lower) ? 'SELL' : null;

    let symbol = '';
    const symbolMatch = message.match(/\b(t(?:META|GOOGL|AAPL|TSLA|AMZN|NVDA|SPY|QQQ|BOND))\b/i)
        || message.match(/\b(META|GOOGL|AAPL|TSLA|AMZN|NVDA|SPY|QQQ|BOND)\b/i);
    if (symbolMatch) {
        const raw = symbolMatch[1].toUpperCase();
        symbol = raw.startsWith('T') ? 't' + raw.slice(1) : 't' + raw;
    }

    let dollarAmount = '';
    let amount = '';
    let price = '';

    const dollarOfMatch = message.match(/\$\s*([\d,]+(?:\.\d+)?)\s+(?:of|worth)/i)
        || message.match(/\b([\d,]+(?:\.\d+)?)\s+(?:dollars?|usd|usdc)\s+(?:of|worth)/i)
        || message.match(/for\s+\$\s*([\d,]+(?:\.\d+)?)/i);

    if (dollarOfMatch) {
        dollarAmount = dollarOfMatch[1].replace(',', '');
    } else {
        const amountMatch = message.match(/\b(\d+(?:\.\d+)?)\s+t(?:META|GOOGL|AAPL|TSLA|AMZN|NVDA|SPY|QQQ|BOND)\b/i);
        if (amountMatch) amount = amountMatch[1];

        const priceMatch = message.match(/(?:at|@|for|price:?)\s*\$?\s*([\d,]+(?:\.\d+)?)/i)
            || message.match(/\$\s*([\d,]+(?:\.\d+)?)\s+(?:each|per)/i);
        if (priceMatch) price = priceMatch[1].replace(',', '');
    }

    return { side, symbol, chain: '', amount, price, dollarAmount };
}

function extractJSON(text: string): any | null {
    try { return JSON.parse(text); } catch {}

    const codeMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeMatch) {
        try { return JSON.parse(codeMatch[1]); } catch {}
    }

    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
        try { return JSON.parse(objMatch[0]); } catch {}
    }

    return null;
}

export class NLParserService {
    /**
     * Parse a natural-language order message into a structured ParsedOrder.
     * @param message       The latest user message
     * @param conversationHistory  Recent chat history so the LLM can resolve context like "buy the tMETA"
     */
    static async parseOrderMessage(
        message: string,
        conversationHistory: Array<{ role: string; content: string }> = []
    ): Promise<ParsedOrder> {
        const defaultResult: ParsedOrder = {
            side: null,
            amount: '',
            price: '',
            dollarAmount: '',
            symbol: '',
            chain: '',
            isValid: false,
            error: undefined,
        };

        // Step 1: Regex fast-path — if the message has all we need, skip the LLM
        const regexResult = regexParse(message);
        const hasEnoughFromRegex = regexResult.side && regexResult.symbol &&
            (regexResult.dollarAmount || (regexResult.amount && regexResult.price));

        let rawParsed: Partial<ParsedOrder> | null = null;

        if (hasEnoughFromRegex) {
            console.log('[NLParser] Using regex result:', regexResult);
            rawParsed = regexResult;
        } else {
            // Step 2: LLM with conversation history so it can resolve context-dependent tokens/sides
            const historyMessages = conversationHistory
                .slice(-6)
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const response = await openai.chat.completions.create({
                        model: AI_MODEL,
                        messages: [
                            { role: 'system', content: PARSE_SYSTEM_PROMPT },
                            ...historyMessages,
                            { role: 'user', content: message },
                        ],
                        temperature: 0,
                        max_tokens: 200,
                    });

                    const content = response.choices[0]?.message?.content?.trim();
                    console.log('[NLParser] LLM response:', content);
                    if (content) rawParsed = extractJSON(content);
                    break;
                } catch (err: any) {
                    const is429 = err?.status === 429 || err?.message?.includes('429');
                    if (is429 && attempt < 2) {
                        const delay = (attempt + 1) * 2000;
                        console.warn(`[NLParser] Rate limited, retrying in ${delay}ms...`);
                        await new Promise(r => setTimeout(r, delay));
                        continue;
                    }
                    if (is429) {
                        console.warn('[NLParser] Rate limited after retries, using regex fallback');
                        rawParsed = regexResult;
                        break;
                    }
                    throw err;
                }
            }
        }

        if (!rawParsed) {
            return { ...defaultResult, error: `Couldn't understand that. Try: "Buy 0.5 tMETA at $100"` };
        }

        const side = rawParsed.side === 'BUY' || rawParsed.side === 'SELL' ? rawParsed.side : null;
        const amount = rawParsed.amount || '';
        const price = rawParsed.price ? String(rawParsed.price).replace('$', '').replace(',', '') : '';
        const dollarAmount = rawParsed.dollarAmount ? String(rawParsed.dollarAmount).replace('$', '').replace(',', '') : '';

        // Normalize symbol: user might say "tmeta", "TMETA", or "META"
        let symbol = (rawParsed.symbol || '').trim();
        if (symbol && !VALID_SYMBOLS.includes(symbol)) {
            const upper = symbol.toUpperCase();
            symbol = upper.startsWith('T') ? 't' + upper.slice(1) : 't' + upper;
        }

        if (symbol && !VALID_SYMBOLS.includes(symbol)) {
            return {
                side, amount, price, dollarAmount, symbol, chain: '',
                isValid: false,
                error: `Invalid token: ${symbol}. Available: ${VALID_SYMBOLS.join(', ')}`,
            };
        }

        const isTradingRequest = !!(side && symbol);
        const hasAmountAndPrice = !!(amount && price);
        const hasDollarAmount = !!dollarAmount;
        // Chain is always empty on this single-chain platform — not required for validity
        const isValid = !!(isTradingRequest && (hasAmountAndPrice || hasDollarAmount));

        let error: string | undefined;
        if (isTradingRequest && !hasAmountAndPrice && !hasDollarAmount) {
            error = 'Please specify either an amount and price, or a dollar value (e.g., "Buy $800 of tNVDA")';
        }

        return { side, amount, price, dollarAmount, symbol, chain: '', isValid, error };
    }

    static isTradingIntent(message: string): boolean {
        const keywords = ['buy', 'sell', 'purchase', 'trade', 'order', 'long', 'short', 'acquire', 'dispose', 'get some', 'pick up', 'drop', 'sell off'];
        const lower = message.toLowerCase();
        return keywords.some(kw => lower.includes(kw));
    }
}
