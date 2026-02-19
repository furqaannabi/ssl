
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres?schema=public",
});

async function main() {
  try {
    await client.connect();
    console.log("Connected to DB.");

    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'TokenBalance';
    `);
    
    console.log("TokenBalance Columns:");
    console.table(res.rows);

  } catch (e) {
    console.error("PG Error:", e);
  } finally {
    await client.end();
  }
}

main();
