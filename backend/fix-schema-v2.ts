
import pg from 'pg';
import addresses from './addresses.json';

const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres?schema=public",
});

async function main() {
  try {
    await client.connect();
    console.log("Connected to DB.");

    // 1. Rename Order Column
    // Check if column exists first to avoid error
    const checkRes = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'Order' AND column_name = 'stealthPublicKey';
    `);

    if (checkRes.rows.length > 0) {
        console.log("Renaming 'stealthPublicKey' to 'stealthAddress' in Order table...");
        await client.query(`
            ALTER TABLE "Order" 
            RENAME COLUMN "stealthPublicKey" TO "stealthAddress";
        `);
        console.log("Column renamed.");
    } else {
        console.log("Column 'stealthPublicKey' not found in Order table (already renamed?). check 'stealthAddress'.");
    }

    // 2. Fix Chain Selectors for Known Tokens
    console.log("Fixing Chain Selectors...");

    // Base Sepolia
    const baseConfig = addresses.chains.baseSepolia;
    if (baseConfig && baseConfig.usdc) {
         await client.query(`
            UPDATE "Token" SET "chainSelector" = $1 WHERE address = $2
         `, [baseConfig.chainSelector, baseConfig.usdc.toLowerCase()]);
         console.log(`Updated Base USDC (${baseConfig.usdc}) to ${baseConfig.chainSelector}`);
    }

    // Arbitrum Sepolia
    const arbConfig = addresses.chains.arbitrumSepolia;
    if (arbConfig && arbConfig.usdc) {
         await client.query(`
            UPDATE "Token" SET "chainSelector" = $1 WHERE address = $2
         `, [arbConfig.chainSelector, arbConfig.usdc.toLowerCase()]);
         console.log(`Updated Arb USDC (${arbConfig.usdc}) to ${arbConfig.chainSelector}`);
    }

    // 3. Fix TokenBalances for these tokens if they have default incorrectly?
    // This is harder. Providing the Tokens are fixed, the Frontend "Unknown Chain" for pairs might be resolved.
    // Balances might still be split or wrong, but let's see.

  } catch (e) {
    console.error("PG Error:", e);
  } finally {
    await client.end();
  }
}

main();
