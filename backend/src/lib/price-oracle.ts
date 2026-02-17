
// Simple Mock Oracle to simulate live market data
// Uses sine waves + random noise to create realistic-looking price movements

interface PriceData {
    symbol: string;
    price: string;
    change24h: string;
    trend: 'UP' | 'DOWN' | 'FLAT';
}

// Base prices to oscillate around
const BASE_PRICES: Record<string, number> = {
    'BOND': 100.00,
    'USDC': 1.00,
    'TBILL': 98.45,
    'BTC': 64200.00,
    'ETH': 3450.00,
    'SOL': 145.00
};

// Volatility factors (higher = more movement)
const VOLATILITY: Record<string, number> = {
    'BOND': 0.05,  // Very stable
    'USDC': 0.001, // Stablecoin (tiny depeg simulation)
    'TBILL': 0.02, // Stable
    'BTC': 50.00,  // Volatile
    'ETH': 15.00,  // Volatile
    'SOL': 1.50   // Volatile
};

export function getOraclePrices(): Record<string, PriceData> {
    const now = Date.now();
    const prices: Record<string, PriceData> = {};

    for (const [symbol, base] of Object.entries(BASE_PRICES)) {
        // Create a time-based sine wave + random noise
        // period: ~1 minute loop
        const timeFactor = (now / 10000) * 2 * Math.PI; 
        const noise = (Math.random() - 0.5) * VOLATILITY[symbol]; 
        const wave = Math.sin(timeFactor) * (VOLATILITY[symbol] * 2);
        
        const currentPrice = base + wave + noise;
        
        // Calculate a mock 24h change (just based on the wave position)
        const changePercent = (wave / base) * 100;
        
        prices[symbol] = {
            symbol,
            price: currentPrice.toFixed(2),
            change24h: changePercent.toFixed(2) + '%',
            trend: changePercent > 0 ? 'UP' : changePercent < 0 ? 'DOWN' : 'FLAT'
        };
    }

    return prices;
}
