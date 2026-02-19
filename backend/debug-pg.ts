
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: "postgresql://postgres:postgres@localhost:5432/postgres?schema=public",
});

async function main() {
  try {
    await client.connect();
    console.log("Connected to DB.");
    
    const res = await client.query(`
      SELECT address, symbol, "chainSelector" 
      FROM "Token"
      ORDER BY symbol;
    `);
    
    console.log("Tokens in DB:");
    console.table(res.rows);
    
    // Also check pending migrations table
    const migs = await client.query(`
        SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;
    `);
    console.log("Recent Migrations:");
    console.table(migs.rows.map(m => ({ name: m.migration_name, finished: m.finished_at })));

  } catch (e) {
    console.error("PG Error:", e);
  } finally {
    await client.end();
  }
}

main();
