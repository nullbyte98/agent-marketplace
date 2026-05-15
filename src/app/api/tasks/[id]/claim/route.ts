import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { json, error, notFound } from "@/lib/api-helpers";
import { buildClaimMessage, verifyWalletSignature } from "@/lib/auth/wallet-signature";
import { bindWorker, taskNonceFromHex } from "@/lib/solana/escrow-client";

const Body = z.object({
  wallet_address: z.string(),
  signature: z.string(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return error("wallet_address and signature required");
  const wallet = parse.data.wallet_address;
  try { new PublicKey(wallet); } catch { return error("Invalid wallet address"); }

  // Require the caller to prove they own the wallet they are claiming as.
  // Without this anyone could claim a task using someone else's address.
  const message = buildClaimMessage(params.id, wallet);
  const valid = verifyWalletSignature({
    message,
    signatureBase58: parse.data.signature,
    walletPubkey: wallet,
  });
  if (!valid) return error("Wallet signature does not verify for this claim", 403);

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

  // Bind the worker on chain so release_to_worker can only target this address.
  // If this fails after the DB write would have committed, the reconciliation
  // script can detect the drift (DB says claimed, chain says no worker bound).
  let bindTxSig: string;
  try {
    bindTxSig = await bindWorker({
      taskNonce: taskNonceFromHex(task.taskNonce),
      workerPubkey: new PublicKey(wallet),
    });
  } catch (e: any) {
    return error("On-chain worker bind failed: " + (e.message ?? String(e)), 500);
  }

  const updated = await db.task.update({
    where: { id: params.id },
    data: { status: "claimed", claimedByWallet: wallet, claimedAt: new Date() },
  });

  return json({ ok: true, task_id: updated.id, claimed_at: updated.claimedAt, bind_tx: bindTxSig });
}
