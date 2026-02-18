import prisma from "../src/clients/prisma";

async function main() {
    console.log("Starting balance fix...");

    // 1. Fetch all balances
    const allBalances = await prisma.tokenBalance.findMany();
    console.log(`Found ${allBalances.length} balance records.`);

    // 2. Group by lowercase key
    const groups: Record<string, typeof allBalances> = {};
    for (const b of allBalances) {
        const key = `${b.userAddress.toLowerCase()}-${b.token.toLowerCase()}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(b);
    }

    // 3. Process groups with duplicates
    for (const key in groups) {
        const records = groups[key];
        if (records.length > 1) {
            console.log(`Found duplicate for ${key}: ${records.length} records`);

            // Calculate total balance
            let total = 0n;
            for (const r of records) {
                total += BigInt(r.balance);
            }

            console.log(`Total balance: ${total.toString()}`);

            // Keep the one that is already lowercase if possible, or just the first one
            // We want to ensure the surviving record has lowercase address/token
            const [userAddr, tokenAddr] = key.split('-');
            
            // Delete all existing
            const ids = records.map(r => r.id);
            await prisma.tokenBalance.deleteMany({
                where: { id: { in: ids } }
            });

            // Create new consolidated record
            await prisma.tokenBalance.create({
                data: {
                    userAddress: userAddr,
                    token: tokenAddr,
                    balance: total.toString()
                }
            });

            console.log(`Merged ${records.length} records into one for ${userAddr}/${tokenAddr}`);
        } else {
            // Even if single record, ensure it is lowercase
            const r = records[0];
            if (r.userAddress !== r.userAddress.toLowerCase() || r.token !== r.token.toLowerCase()) {
                console.log(`Fixing casing for ${r.userAddress}/${r.token}`);
                // Delete and recreate to avoid unique constraint if we just update one field at a time
                // actually we can update if no collision
                await prisma.tokenBalance.delete({ where: { id: r.id } });
                await prisma.tokenBalance.create({
                    data: {
                        userAddress: r.userAddress.toLowerCase(),
                        token: r.token.toLowerCase(),
                        balance: r.balance
                    }
                });
            }
        }
    }

    console.log("Balance fix complete.");
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
