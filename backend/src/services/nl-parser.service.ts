/**
 * Natural Language Parser Service
 * Parses user messages like "Buy 0.5 tNVDA at $800 on Base"
 * into structured order objects
 */

import openai, { AI_MODEL } from '../clients/openai';

const VALID_SYMBOLS = ['tMETA', 'tGOOGL', 'tAAPL', 'tTSLA', 'tAMZN', 'tNVDA', 'tSPY', 'tQQQ', 'tBOND'];
const VALID_CHAINS = ['base', 'baseSepolia', 'arbitrum', 'arbitrumSepolia'];

/**
 * Regex-based fallback parser - no LLM needed, works offline
 * Handles patterns like:
 * - "Buy 0.5 tNVDA at $800 on Base"
 * - "Buy $800 of tNVDA on Base"
 * - "Sell 10 tAAPL on Arbitrum"
 */
function regexParse(message: string): Partial<ParsedOrder> {
    const lower = message.toLowerCase();

    // Side
    const side: 'BUY' | 'SELL' | null = 
        /\b(buy|purchase|long|acquire|get)\b/.test(lower) ? 'BUY' :
        /\b(sell|short|dispose|drop)\b/.test(lower) ? 'SELL' : null;

    // Symbol - find tXXXX pattern or bare ticker
    let symbol = '';
    const symbolMatch = message.match(/\b(t(?:META|GOOGL|AAPL|TSLA|AMZN|NVDA|SPY|QQQ|BOND))\b/i)
        || message.match(/\b(META|GOOGL|AAPL|TSLA|AMZN|NVDA|SPY|QQQ|BOND)\b/i);
    if (symbolMatch) {
        const raw = symbolMatch[1].toUpperCase();
        symbol = raw.startsWith('T') ? 't' + raw.slice(1) : 't' + raw;
    }

    // Chain
    let chain = '';
    if (/\b(base|basesepolia)\b/.test(lower)) chain = 'baseSepolia';
    else if (/\b(arbitrum|arbitrumsepolia|arb)\b/.test(lower)) chain = 'arbitrumSepolia';

    // Dollar amount pattern: "$800 of tNVDA" or "for $800"
    let dollarAmount = '';
    let amount = '';
    let price = '';

    const dollarOfMatch = message.match(/\$\s*([\d,]+(?:\.\d+)?)\s+(?:of|worth)/i)
        || message.match(/\b([\d,]+(?:\.\d+)?)\s+(?:dollars?|usd|usdc)\s+(?:of|worth)/i)
        || message.match(/for\s+\$\s*([\d,]+(?:\.\d+)?)/i);

    if (dollarOfMatch) {
        dollarAmount = dollarOfMatch[1].replace(',', '');
    } else {
        // Amount + price pattern: "0.5 tNVDA at $800" or "5 tNVDA for $1"
        const amountMatch = message.match(/\b(\d+(?:\.\d+)?)\s+t(?:META|GOOGL|AAPL|TSLA|AMZN|NVDA|SPY|QQQ|BOND)\b/i);
        if (amountMatch) amount = amountMatch[1];

        const priceMatch = message.match(/(?:at|@|for|price:?)\s*\$?\s*([\d,]+(?:\.\d+)?)/i)
            || message.match(/\$\s*([\d,]+(?:\.\d+)?)\s+(?:each|per)/i);
        if (priceMatch) price = priceMatch[1].replace(',', '');
    }

    return { side, symbol, chain, amount, price, dollarAmount };
}

export interface ParsedOrder {
    side: 'BUY' | 'SELL' | null;
    amount: string;
    price: string;
    dollarAmount: string;  // For "Buy $800 of tNVDA" style orders
    symbol: string;
    chain: string;
    isValid: boolean;
    error?: string;
}

function extractJSON(text: string): any | null {
    // Try direct parse first
    try { return JSON.parse(text); } catch {}
    
    // Try finding JSON in markdown code block
    const codeMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeMatch) {
        try { return JSON.parse(codeMatch[1]); } catch {}
    }
    
    // Try finding any JSON object in text
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
        try { return JSON.parse(objMatch[0]); } catch {}
    }
    
    return null;
}

const PARSE_SYSTEM_PROMPT = `You are a trading order parser for the SSL (Stealth Settlement Layer) platform.

Your job is to extract structured order information from natural language messages.

VALID TOKENS: tMETA, tGOOGL, tAAPL, tTSLA, tAMZN, tNVDA, tSPY, tQQQ, tBOND (these are tokenized stocks/ETFs)
VALID CHAINS: base, baseSepolia, arbitrum, arbitrumSepolia

INSTRUCTIONS:
1. Extract the following from the user's message:
   - side: "BUY" or "SELL" (or null if not specified)
   - amount: the quantity of tokens (e.g., "0.5", "10", "1.5") - ONLY use this when user specifies a token count like "0.5 tNVDA"
   - price: the price per unit in USD (e.g., "800", "$800", "800.50") - use when user says "at $800" or "for $800 each"
   - dollarAmount: the total dollar value to spend (e.g., "800", "$800") - use when user says "Buy $800 of tNVDA" or "Buy tNVDA for $800"
   - symbol: the token symbol (e.g., "tNVDA", "tAAPL")
   - chain: the blockchain (e.g., "base", "arbitrum" - or empty string if not specified)

2. IMPORTANT - Handle confusing inputs:
   - If user says "Buy 5 $5 tMETA" - this is confusing. Prefer "amount": "5" (token count) over dollarAmount
   - If user says "Buy 5 tMETA at $1" - amount="5", price="1"
   - If user says "Buy $5 of tMETA" - dollarAmount="5"
   - Never set both amount AND dollarAmount - pick the clearest one

3. If the user does NOT specify a chain, return chain as empty string "" (the frontend will ask them)

4. If the user does NOT specify a side (buy/sell), return side as null

5. Return ONLY a JSON object with exactly these fields:
   { "side": "BUY"|"SELL"|null, "amount": string, "price": string, "dollarAmount": string, "symbol": string, "chain": string }

EXAMPLES:
- "Buy 0.5 tNVDA at $800 on Base" → { "side": "BUY", "amount": "0.5", "price": "800", "dollarAmount": "", "symbol": "tNVDA", "chain": "base" }
- "Buy $800 of tNVDA on Base" → { "side": "BUY", "amount": "", "price": "", "dollarAmount": "800", "symbol": "tNVDA", "chain": "base" }
- "Buy tNVDA for $800 on Arbitrum" → { "side": "BUY", "amount": "", "price": "", "dollarAmount": "800", "symbol": "tNVDA", "chain": "arbitrum" }
- "Buy 5 tMETA at $1" → { "side": "BUY", "amount": "5", "price": "1", "dollarAmount": "", "symbol": "tMETA", "chain": "" }
- "Sell 10 tAAPL" → { "side": "SELL", "amount": "10", "price": "", "dollarAmount": "", "symbol": "tAAPL", "chain": "" }
- "Buy tGOOGL" → { "side": "BUY", "amount": "", "price": "", "dollarAmount": "", "symbol": "tGOOGL", "chain": "" }
- "What is the price of tNVDA?" → { "side": null, "amount": "", "price": "", "dollarAmount": "", "symbol": "tNVDA", "chain": "" }

Respond with ONLY the JSON object, no additional text.`;

export class NLParserService {
    static async parseOrderMessage(message: string): Promise<ParsedOrder> {
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

        // --- Step 1: Try regex parser first (no LLM, no rate limits) ---
        const regexResult = regexParse(message);
        const hasEnoughFromRegex = regexResult.side && regexResult.symbol &&
            (regexResult.dollarAmount || (regexResult.amount && regexResult.price));

        let rawParsed: Partial<ParsedOrder> | null = null;

        if (hasEnoughFromRegex) {
            // Regex got enough info, skip LLM call
            console.log('[NLParser] Using regex result:', regexResult);
            rawParsed = regexResult;
        } else {
            // --- Step 2: Try LLM with retry on 429 ---
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const response = await openai.chat.completions.create({
                        model: AI_MODEL,
                        messages: [
                            { role: 'system', content: PARSE_SYSTEM_PROMPT },
                            { role: 'user', content: message },
                        ],
                        temperature: 0,
                        max_tokens: 200,
                    });

                    const content = response.choices[0]?.message?.content?.trim();
                    console.log('[NLParser] LLM response:', content);
                    if (content) {
                        rawParsed = extractJSON(content);
                    }
                    break; // Success, exit retry loop
                } catch (err: any) {
                    const is429 = err?.status === 429 || err?.message?.includes('429');
                    if (is429 && attempt < 2) {
                        const delay = (attempt + 1) * 2000; // 2s, 4s
                        console.warn(`[NLParser] Rate limited, retrying in ${delay}ms...`);
                        await new Promise(r => setTimeout(r, delay));
                        continue;
                    }
                    if (is429) {
                        // All retries failed - use regex result even if incomplete
                        console.warn('[NLParser] Rate limited after retries, using regex fallback');
                        rawParsed = regexResult;
                        break;
                    }
                    throw err;
                }
            }
        }

        if (!rawParsed) {
            return { ...defaultResult, error: `Couldn't understand that. Try: "Buy 0.5 tMETA at $100 on Base" or "Buy $50 of tMETA on Base"` };
        }

        // Validate and normalize
        const side = rawParsed.side === 'BUY' || rawParsed.side === 'SELL' ? rawParsed.side : null;
        const amount = rawParsed.amount || '';
        const price = rawParsed.price ? String(rawParsed.price).replace('$', '').replace(',', '') : '';
        const dollarAmount = rawParsed.dollarAmount ? String(rawParsed.dollarAmount).replace('$', '').replace(',', '') : '';
        
        // Normalize symbol: user might say "tmeta", "TMETA", or "META" - normalize to "tMETA"
        let symbol = (rawParsed.symbol || '').trim();
        if (symbol && !VALID_SYMBOLS.includes(symbol)) {
            symbol = 't' + symbol.toUpperCase();
        }
        
        let chain = (rawParsed.chain || '').toLowerCase();

        // Normalize chain names
        if (chain === 'base' || chain === 'basesepolia') chain = 'baseSepolia';
        if (chain === 'arbitrum' || chain === 'arbitrumsepolia' || chain === 'arb') chain = 'arbitrumSepolia';

        // Validate symbol
        if (symbol && !VALID_SYMBOLS.includes(symbol)) {
            return {
                side,
                amount,
                price,
                dollarAmount,
                symbol,
                chain,
                isValid: false,
                error: `Invalid token: ${symbol}. Available: ${VALID_SYMBOLS.join(', ')}`,
            };
        }

        // Validate chain (if specified)
        if (chain && !VALID_CHAINS.includes(chain)) {
            return {
                side,
                amount,
                price,
                dollarAmount,
                symbol,
                chain: '',
                isValid: false,
                error: `Invalid chain: ${chain}. Valid: Base, Arbitrum`,
            };
        }

        // Check if it's a trading request (has side and symbol)
        const isTradingRequest = side && symbol;

        // Valid if: has amount+price OR has dollarAmount (we'll calculate the other)
        const hasAmountAndPrice = amount && price;
        const hasDollarAmount = dollarAmount;
        const isValid = !!(isTradingRequest && (hasAmountAndPrice || hasDollarAmount) && chain);

        let error: string | undefined;
        if (isTradingRequest) {
            if (!hasAmountAndPrice && !hasDollarAmount) {
                error = 'Please specify either an amount and price, or a dollar value (e.g., "Buy $800 of tNVDA on Base")';
            } else if (!chain) {
                error = 'Please specify a chain (Base or Arbitrum)';
            }
        }

        return {
            side,
            amount,
            price,
            dollarAmount,
            symbol,
            chain,
            isValid,
            error,
        };
    }

    static isTradingIntent(message: string): boolean {
        const tradingKeywords = [
            'buy', 'sell', 'purchase', 'trade', 'order', 'long', 'short',
            'acquire', 'dispose', 'get some', 'pick up', 'drop', 'sell off'
        ];
        const lower = message.toLowerCase();
        return tradingKeywords.some(kw => lower.includes(kw));
    }
}
