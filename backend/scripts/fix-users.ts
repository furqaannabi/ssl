
import prisma from "../src/clients/prisma";

async function main() {
    console.log("Starting User Fix...");

    const users = await prisma.user.findMany();
    console.log(`Found ${users.length} users.`);

    // Group by lowercase address
    const groups: Record<string, typeof users> = {};
    for (const u of users) {
        const key = u.address.toLowerCase();
        if (!groups[key]) groups[key] = [];
        groups[key].push(u);
    }

    for (const key in groups) {
        const dups = groups[key];
        if (dups.length > 1) {
            console.log(`Found duplicates for ${key}: ${dups.map(u => u.address).join(', ')}`);

            // Identify Target (Lowercase) and Source (Checksummed)
            let target = dups.find(u => u.address === key);
            const source = dups.find(u => u.address !== key); // Just take the first non-lowercase

            if (!target) {
                console.log(`No lowercase target found for ${key}. Creating invalid state? Skipping.`);
                continue;
            }

            if (source) {
                console.log(`Merging ${source.address} -> ${target.address}`);
                
                // 1. Copy Verification Status if source is verified and target is not
                if (source.isVerified && !target.isVerified) {
                    console.log(`Transferring verification status...`);
                    await prisma.user.update({
                        where: { address: target.address },
                        data: { isVerified: true }
                    });
                }

                // 2. Re-link related records (Transactions, Orders, Withdrawals)
                // Note: TokenBalances are likely already on the correct one due to listener fix/previous script?
                // Or maybe they are split.
                // Let's check if source has any balances.
                const sourceBalances = await prisma.tokenBalance.findMany({ where: { userAddress: source.address } });
                if (sourceBalances.length > 0) {
                    console.log(`Source has ${sourceBalances.length} balance records. Moving...`);
                    for (const b of sourceBalances) {
                        try {
                            // Try to update userAddress to target
                            // This might fail if target already has a balance for that token (Unique constraint)
                            // If so, we should add amounts and delete source.
                            await prisma.tokenBalance.update({
                                where: { id: b.id },
                                data: { userAddress: target.address }
                            });
                        } catch (e) {
                            console.log(`Collision moving balance ${b.token}. Merging amounts.`);
                            // Fetch target balance
                            const targetBal = await prisma.tokenBalance.findUnique({
                                where: { userAddress_token: { userAddress: target.address, token: b.token } }
                            });
                            
                            if (targetBal) {
                                const newAmount = BigInt(targetBal.balance) + BigInt(b.balance);
                                await prisma.tokenBalance.update({
                                    where: { id: targetBal.id },
                                    data: { balance: newAmount.toString() }
                                });
                                // Delete source record
                                await prisma.tokenBalance.delete({ where: { id: b.id } });
                            }
                        }
                    }
                }

                // We should also move Orders, Transactions, Withdrawals, Sessions
                // Logic is similar: update userAddress unless collision (unlikely for these tables except ID)
                // Actually most use userAddress as foreign key.
                
                await prisma.order.updateMany({
                    where: { userAddress: source.address },
                    data: { userAddress: target.address }
                });
                
                await prisma.transaction.updateMany({
                    where: { userAddress: source.address },
                    data: { userAddress: target.address }
                });

                await prisma.withdrawal.updateMany({
                    where: { userAddress: source.address },
                    data: { userAddress: target.address }
                });

                // Delete source sessions
                await prisma.session.deleteMany({ where: { userAddress: source.address } });

                // Delete source user
                console.log(`Deleting source user ${source.address}`);
                await prisma.user.delete({ where: { address: source.address } });
            }
        }
    }

    console.log("User User Fix Complete.");
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
