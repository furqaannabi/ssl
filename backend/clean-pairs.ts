import prisma from "./src/clients/prisma";

const VALID_SYMBOLS = ["tMETA","tGOOGL","tAAPL","tTSLA","tAMZN","tNVDA","tSPY","tQQQ","tBOND"];

const all = await prisma.pair.findMany();
console.log("Total pairs:", all.length);
console.log("All baseSymbols:", all.map(p => p.baseSymbol));

const toDelete = all.filter(p => !VALID_SYMBOLS.includes(p.baseSymbol));
console.log("Pairs to delete:", toDelete.length, toDelete.map(p => p.baseSymbol));

if (toDelete.length === 0) {
    console.log("Nothing to delete.");
} else {
    const result = await prisma.pair.deleteMany({
        where: { baseSymbol: { notIn: VALID_SYMBOLS } },
    });
    console.log("Deleted:", result.count, "pair(s)");
}

await prisma.$disconnect();
