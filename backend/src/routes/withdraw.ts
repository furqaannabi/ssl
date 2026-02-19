import { Hono } from "hono";
import prisma from "../clients/prisma";
import { sendToCRE } from "../lib/cre-client";
import { streamText } from "hono/streaming";
import { authMiddleware } from "../middleware/auth";

type Variables = {
    userAddress: string;
};

export const withdraw = new Hono<{ Variables: Variables }>();

withdraw.use("*", authMiddleware);

// ── POST /api/withdraw ──
withdraw.post("/", async (c) => {
    const userAddress = c.get("userAddress");
    const body = await c.req.json<{
        token: string;
        amount: string;
        withdrawalId: string;
    }>();

    if (!body.token || !body.amount || !body.withdrawalId) {
        return c.json({ error: "Missing required fields: token, amount, withdrawalId" }, 400);
    }

    const token = body.token.toLowerCase();
    const requestedAmount = BigInt(body.amount);

    return streamText(c, async (stream) => {
        const send = (obj: object) => stream.write(`${JSON.stringify(obj)}\n`);

        try {
            const balanceRecord = await prisma.tokenBalance.findFirst({
                where: { userAddress, token },
            });

            const currentBalance = balanceRecord ? BigInt(balanceRecord.balance) : 0n;

            if (currentBalance < requestedAmount) {
                await send({ type: "result", success: false, error: "Insufficient balance" });
                return;
            }

            const newBalance = currentBalance - requestedAmount;

            const existing = await prisma.withdrawal.findUnique({
                where: { withdrawalId: body.withdrawalId },
            });

            await prisma.$transaction([
                prisma.tokenBalance.update({
                    where: { id: balanceRecord!.id },
                    data: { balance: newBalance.toString() },
                }),
                existing
                    ? prisma.withdrawal.update({
                        where: { withdrawalId: body.withdrawalId },
                        data: { status: "PROCESSING" },
                    })
                    : prisma.withdrawal.create({
                        data: {
                            withdrawalId: body.withdrawalId,
                            userAddress,
                            token,
                            amount: body.amount,
                            status: "PROCESSING",
                        },
                    }),
            ]);

            await send({ type: "log", message: "Balance deducted. Forwarding withdrawal to CRE..." });

            try {
                await sendToCRE(
                    {
                        action: "withdraw",
                        withdrawalId: body.withdrawalId,
                        userAddress,
                        amount: body.amount,
                        token,
                    },
                    async (log) => {
                        await send({ type: "log", message: log });
                    }
                );

                await prisma.withdrawal.update({
                    where: { withdrawalId: body.withdrawalId },
                    data: { status: "COMPLETED" },
                });

                await send({
                    type: "result",
                    success: true,
                    withdrawalId: body.withdrawalId,
                    status: "COMPLETED",
                });
            } catch (creError) {
                console.error("[withdraw] CRE failed, refunding balance:", creError);

                await prisma.$transaction([
                    prisma.tokenBalance.update({
                        where: { id: balanceRecord!.id },
                        data: { balance: currentBalance.toString() },
                    }),
                    prisma.withdrawal.update({
                        where: { withdrawalId: body.withdrawalId },
                        data: { status: "FAILED" },
                    }),
                ]);

                await send({
                    type: "result",
                    success: false,
                    error: "CRE processing failed. Balance refunded.",
                });
            }
        } catch (err) {
            console.error("[withdraw] Error:", err);
            await send({ type: "result", success: false, error: "Internal error" });
        }
    });
});

// ── GET /api/withdraw ──
withdraw.get("/", async (c) => {
    const userAddress = c.get("userAddress");
    const status = c.req.query("status");

    const where: any = { userAddress };
    if (status) where.status = status;

    const withdrawals = await prisma.withdrawal.findMany({
        where,
        orderBy: { createdAt: "desc" },
    });

    return c.json({ success: true, withdrawals });
});
