import prisma from '../src/clients/prisma'

async function main() {
    const result = await prisma.order.deleteMany({
        where: {
            status: 'OPEN'
        }
    })
    console.log(`Deleted ${result.count} old pending/open orders to prevent TEE crashes.`)
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
    })
