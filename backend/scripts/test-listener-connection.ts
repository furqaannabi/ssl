
import { ethers } from "ethers";

async function main() {
    const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
    console.log(`Testing connection to ${RPC_URL}...`);

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const network = await provider.getNetwork();
        console.log(`Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
    } catch (error) {
        console.error("Failed to connect to RPC:", error);
    }
}

main();
