import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { json, error, notFound } from "@/lib/api-helpers";

const Body = z.object({ wallet_address: z.string() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return error("wallet_address required");
  const wallet = parse.data.wallet_address;
  try { new PublicKey(wallet); } catch { return error("Invalid wallet address"); }

  const task = await db.task.findUnique({ where: { id: params.id } });
  if (!task) return notFound("Task not found");
  if (task.status !== "open") return error(`Task is ${task.status}, not open`, 409);
  if (task.deadlineAt < new Date()) return error("Task deadline has passed", 409);

  // v1 rule: a worker can only have one active claim at a time.
  const active = await db.task.findFirst({
    where: {
      claimedByWallet: wallet,
      status: { in: ["claimed", "submitted"] },
    },
  });
  if (active) return error("You already have an active claim. Submit or wait for it to resolve first.", 409);

  // Ensure worker record exists.
  await db.worker.upsert({
    where: { walletAddress: wallet },
    update: {},
    create: { walletAddress: wallet },
  });

  const updated = await db.task.update({
    where: { id: params.id },
    data: { status: "claimed", claimedByWallet: wallet, claimedAt: new Date() },
  });

  return json({ ok: true, task_id: updated.id, claimed_at: updated.claimedAt });
}
