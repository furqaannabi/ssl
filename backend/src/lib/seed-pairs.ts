/**
 * Pair Seeder
 * Creates every RWA/USDC pair combination across both chains:
 *   - Same-chain:  tMETA[Base]/USDC[Base], tMETA[Arb]/USDC[Arb], ...
 *   - Cross-chain: tMETA[Base]/USDC[Arb], tMETA[Arb]/USDC[Base], ...
 *
 * Safe to run multiple times — uses the unique constraint on (baseTokenAddress, quoteTokenAddress).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import prisma from '../clients/prisma';

const CHAIN_SELECTORS: Record<string, string> = {
    baseSepolia:      'ethereum-testnet-sepolia-base-1',
    arbitrumSepolia:  'ethereum-testnet-sepolia-arbitrum-1',
};

export async function seedPairs(): Promise<void> {
    try {
        const rwaTokens  = JSON.parse(readFileSync(join(process.cwd(), 'rwa-tokens.json'), 'utf-8'));
        const addresses  = JSON.parse(readFileSync(join(process.cwd(), 'addresses.json'), 'utf-8'));

        // Build { chainSelector -> usdcAddress } map
        const usdcByChain: Record<string, string> = {};
        for (const [chainName, chainData] of Object.entries(addresses.chains)) {
            const selector = CHAIN_SELECTORS[chainName];
            if (selector) usdcByChain[selector] = ((chainData as any).usdc as string).toLowerCase();
        }

        // Collect all RWA tokens: { address, chainSelector, symbol }[]
        const rwaList: { address: string; chainSelector: string; symbol: string }[] = [];
        for (const [chainName, chainData] of Object.entries(rwaTokens.chains)) {
            const selector = CHAIN_SELECTORS[chainName];
            if (!selector) continue;
            for (const [symbol, addr] of Object.entries((chainData as any).tokens as Record<string, string>)) {
                rwaList.push({ address: addr.toLowerCase(), chainSelector: selector, symbol });
            }
        }

        let created = 0;
        let skipped = 0;

        for (const rwa of rwaList) {
            // Pair with USDC on every chain (same-chain + cross-chain)
            for (const [quoteChainSelector, usdcAddress] of Object.entries(usdcByChain)) {
                const isCrossChain = rwa.chainSelector !== quoteChainSelector;
                try {
                    await prisma.pair.upsert({
                        where: {
                            baseTokenAddress_quoteTokenAddress: {
                                baseTokenAddress:  rwa.address,
                                quoteTokenAddress: usdcAddress,
                            },
                        },
                        update: {}, // nothing to update — pair already exists
                        create: {
                            baseTokenAddress:  rwa.address,
                            quoteTokenAddress: usdcAddress,
                        },
                    });
                    console.log(`[seedPairs] ✓ ${rwa.symbol}[${rwa.chainSelector}] / USDC[${quoteChainSelector}]${isCrossChain ? ' [CCIP]' : ''}`);
                    created++;
                } catch (err: any) {
                    // Likely a FK violation — token not yet in Token table
                    console.warn(`[seedPairs] Skipped ${rwa.symbol} / USDC[${quoteChainSelector}]: ${err?.message}`);
                    skipped++;
                }
            }
        }

        console.log(`[seedPairs] ✓ Done — ${created} upserted, ${skipped} skipped`);
    } catch (err) {
        console.error('[seedPairs] Failed:', err);
    }
}
