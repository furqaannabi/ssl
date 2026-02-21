import prisma from './src/clients/prisma';

async function main() {
    const userAddress = '0x095200fdc5513abebbe0ff502fa6d6cfdfa38ff1'.toLowerCase();
    const balances = await prisma.tokenBalance.findMany({ where: { userAddress } });
    
    console.log(`Found ${balances.length} balances for ${userAddress}`);
    
    for (const b of balances) {
        const t = await prisma.token.findUnique({ where: { address: b.token } });
        console.log({
            tokenAddress: b.token,
            symbol: t?.symbol,
            rawBalance: b.balance,
            humanBalance: Number(b.balance) / (10 ** (t?.decimals || 18))
        });
    }
}

main()
    .catch(console.error)
    .finally(() => process.exit(0));
