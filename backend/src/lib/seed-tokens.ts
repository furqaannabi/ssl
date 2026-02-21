/**
 * Token Seeder
 * Seeds the Token table from rwa-tokens.json on startup.
 * Uses upsert to avoid duplicates — safe to run multiple times.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import prisma from '../clients/prisma';

// Metadata for known RWA symbols
const TOKEN_META: Record<string, { name: string; decimals: number }> = {
    tMETA:  { name: 'Tokenized META',    decimals: 18 },
    tGOOGL: { name: 'Tokenized GOOGL',   decimals: 18 },
    tAAPL:  { name: 'Tokenized AAPL',    decimals: 18 },
    tTSLA:  { name: 'Tokenized TSLA',    decimals: 18 },
    tAMZN:  { name: 'Tokenized AMZN',    decimals: 18 },
    tNVDA:  { name: 'Tokenized NVDA',    decimals: 18 },
    tSPY:   { name: 'Tokenized SPY ETF', decimals: 18 },
    tQQQ:   { name: 'Tokenized QQQ ETF', decimals: 18 },
    tBOND:  { name: 'Tokenized US Bond', decimals: 18 },
};

// Chain name in rwa-tokens.json → chainSelector used in the system
const CHAIN_SELECTORS: Record<string, string> = {
    baseSepolia: 'ethereum-testnet-sepolia-base-1',
    arbitrumSepolia: 'ethereum-testnet-sepolia-arbitrum-1',
};

export async function seedTokens(): Promise<void> {
    try {
        // Read rwa-tokens.json from project root
        const filePath = join(process.cwd(), 'rwa-tokens.json');
        const raw = readFileSync(filePath, 'utf-8');
        const rwaTokens = JSON.parse(raw);

        let count = 0;

        for (const [chainName, chainData] of Object.entries(rwaTokens.chains)) {
            const chainSelector = CHAIN_SELECTORS[chainName];
            if (!chainSelector) {
                console.warn(`[seed] Unknown chain: ${chainName}, skipping`);
                continue;
            }

            const tokens = (chainData as any).tokens as Record<string, string>;
            if (!tokens) continue;

            for (const [symbol, address] of Object.entries(tokens)) {
                const meta = TOKEN_META[symbol] || { name: symbol, decimals: 18 };

                await prisma.token.upsert({
                    where: { address: address.toLowerCase() },
                    update: {}, // Don't overwrite manually edited data
                    create: {
                        address: address.toLowerCase(),
                        symbol,
                        name: meta.name,
                        decimals: meta.decimals,
                        chainSelector,
                    },
                });
                count++;
            }
        }

        // Also seed USDC from addresses.json for each chain
        try {
            const addressesPath = join(process.cwd(), 'addresses.json');
            const addressesRaw = readFileSync(addressesPath, 'utf-8');
            const addresses = JSON.parse(addressesRaw);

            for (const [chainName, chainData] of Object.entries(addresses.chains)) {
                const chainSelector = CHAIN_SELECTORS[chainName];
                if (!chainSelector) continue;

                const usdcAddress = (chainData as any).usdc;
                if (usdcAddress) {
                    await prisma.token.upsert({
                        where: { address: usdcAddress.toLowerCase() },
                        update: {},
                        create: {
                            address: usdcAddress.toLowerCase(),
                            symbol: 'USDC',
                            name: 'USD Coin',
                            decimals: 6,
                            chainSelector,
                        },
                    });
                    count++;
                }
            }
        } catch (e) {
            console.warn('[seed] Could not seed USDC from addresses.json:', e);
        }

        // Seed one pair per unique RWA symbol (chain-agnostic)
        const symbols = Object.keys(TOKEN_META);
        for (const symbol of symbols) {
            await prisma.pair.upsert({
                where: { baseSymbol: symbol },
                update: {},
                create: { baseSymbol: symbol },
            });
        }

        console.log(`[seed] ✓ Upserted ${count} tokens + ${symbols.length} pairs across ${Object.keys(rwaTokens.chains).length} chains`);
    } catch (err) {
        console.error('[seed] Failed to seed tokens:', err);
    }
}
