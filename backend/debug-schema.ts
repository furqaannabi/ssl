import { PrismaClient } from "./generated/prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    console.log("Inspecting 'User' table columns...");
    const result = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'User' OR table_name = 'user'
    `;
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
