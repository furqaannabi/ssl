
import prisma from "../src/clients/prisma";

async function main() {
    console.log("--- TokenBalances ---");
    const balances = await prisma.tokenBalance.findMany();
    console.table(balances);

    console.log("\n--- Tokens ---");
    const tokens = await prisma.token.findMany();
    console.table(tokens);

    console.log("\n--- Users ---");
    const users = await prisma.user.findMany();
    console.table(users);
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
