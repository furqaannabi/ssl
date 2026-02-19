
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres?schema=public",
});

async function main() {
  try {
    await client.connect();
    console.log("Connected to DB.");

    // Check balances for the specific user (from previous logs)
    // Or just list all balances
    const res = await client.query(`
        SELECT "userAddress", token, balance, "chainSelector"
        FROM "TokenBalance"
    `);
    
    console.log("Token Balances:");
    console.table(res.rows);

  } catch (e) {
    console.error("PG Error:", e);
  } finally {
    await client.end();
  }
}

main();
