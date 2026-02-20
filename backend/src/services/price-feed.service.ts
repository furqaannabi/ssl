/**
 * Price Feed Service
 * Fetches real-time stock/ETF prices from Finnhub API
 * Maps RWA token symbols to real ticker symbols
 */

const SYMBOL_MAP: Record<string, string> = {
    'tMETA': 'META',
    'tGOOGL': 'GOOGL',
    'tAAPL': 'AAPL',
    'tTSLA': 'TSLA',
    'tAMZN': 'AMZN',
    'tNVDA': 'NVDA',
    'tSPY': 'SPY',
    'tQQQ': 'QQQ',
    'tBOND': 'TLT', // iShares 20+ Year Treasury Bond ETF as proxy
    'BOND': 'TLT',
};

export interface PriceData {
    symbol: string;
    realSymbol: string;
    price: number;
    change: number;
    changePercent: number;
    high: number;
    low: number;
    open: number;
    previousClose: number;
    timestamp: number;
}

// In-memory cache
const priceCache = new Map<string, { data: PriceData; fetchedAt: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

export class PriceFeedService {
    private static apiKey = process.env.FINNHUB_API_KEY || '';
    private static baseUrl = 'https://finnhub.io/api/v1';

    static getRealSymbol(tokenSymbol: string): string | null {
        return SYMBOL_MAP[tokenSymbol] || null;
    }

    static async getPrice(tokenSymbol: string): Promise<PriceData | null> {
        const realSymbol = this.getRealSymbol(tokenSymbol);
        if (!realSymbol) return null;

        // Check cache
        const cached = priceCache.get(tokenSymbol);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
            return cached.data;
        }

        try {
            const url = `${this.baseUrl}/quote?symbol=${realSymbol}&token=${this.apiKey}`;
            const res = await fetch(url);
            if (!res.ok) {
                console.error(`[PriceFeed] Finnhub error for ${realSymbol}: ${res.status}`);
                return cached?.data || null;
            }

            const data = await res.json();
            // Finnhub quote response: c=current, d=change, dp=percent change, h=high, l=low, o=open, pc=previous close, t=timestamp
            if (!data.c || data.c === 0) {
                console.warn(`[PriceFeed] No price data for ${realSymbol}`);
                return cached?.data || null;
            }

            const priceData: PriceData = {
                symbol: tokenSymbol,
                realSymbol,
                price: data.c,
                change: data.d || 0,
                changePercent: data.dp || 0,
                high: data.h || data.c,
                low: data.l || data.c,
                open: data.o || data.c,
                previousClose: data.pc || data.c,
                timestamp: data.t ? data.t * 1000 : Date.now(),
            };

            priceCache.set(tokenSymbol, { data: priceData, fetchedAt: Date.now() });
            return priceData;
        } catch (err) {
            console.error(`[PriceFeed] Failed to fetch ${realSymbol}:`, err);
            return cached?.data || null;
        }
    }

    static async getAllPrices(): Promise<Record<string, PriceData>> {
        const results: Record<string, PriceData> = {};
        const symbols = Object.keys(SYMBOL_MAP);

        // Fetch in parallel with small batches to respect rate limits
        const batchSize = 5;
        for (let i = 0; i < symbols.length; i += batchSize) {
            const batch = symbols.slice(i, i + batchSize);
            const prices = await Promise.all(batch.map(s => this.getPrice(s)));
            batch.forEach((sym, idx) => {
                if (prices[idx]) results[sym] = prices[idx]!;
            });
        }

        return results;
    }

    /** Get a mock/fallback price for demo when no API key is set */
    static getMockPrice(tokenSymbol: string): PriceData {
        const mockPrices: Record<string, number> = {
            'tMETA': 595.20,
            'tGOOGL': 178.30,
            'tAAPL': 232.50,
            'tTSLA': 352.80,
            'tAMZN': 218.40,
            'tNVDA': 138.50,
            'tSPY': 598.40,
            'tQQQ': 518.20,
            'tBOND': 87.50,
            'BOND': 87.50,
        };

        const basePrice = mockPrices[tokenSymbol] || 100;
        // Add small random variance for demo
        const variance = (Math.random() - 0.5) * basePrice * 0.02;
        const price = basePrice + variance;
        const change = variance;

        return {
            symbol: tokenSymbol,
            realSymbol: SYMBOL_MAP[tokenSymbol] || tokenSymbol,
            price: Math.round(price * 100) / 100,
            change: Math.round(change * 100) / 100,
            changePercent: Math.round((change / basePrice) * 10000) / 100,
            high: Math.round((price + Math.abs(variance)) * 100) / 100,
            low: Math.round((price - Math.abs(variance)) * 100) / 100,
            open: basePrice,
            previousClose: basePrice,
            timestamp: Date.now(),
        };
    }

    /** Returns real price if API key set, otherwise mock */
    static async getPriceOrMock(tokenSymbol: string): Promise<PriceData> {
        if (this.apiKey) {
            const real = await this.getPrice(tokenSymbol);
            if (real) return real;
        }
        return this.getMockPrice(tokenSymbol);
    }

    static async getAllPricesOrMock(): Promise<Record<string, PriceData>> {
        if (this.apiKey) {
            const real = await this.getAllPrices();
            if (Object.keys(real).length > 0) return real;
        }
        // Return mock for all
        const results: Record<string, PriceData> = {};
        for (const sym of Object.keys(SYMBOL_MAP)) {
            results[sym] = this.getMockPrice(sym);
        }
        return results;
    }
}
