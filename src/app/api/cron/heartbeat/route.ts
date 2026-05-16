/**
 * Vercel Cron heartbeat. Drives one full demo loop end-to-end so the live URL
 * always has recent on-chain activity for visitors to see. Same machinery as
 * /api/demo/run, just without the streaming UI.
 *
 * Vercel calls this on the schedule configured in vercel.json. Cron-only auth:
 * Vercel attaches an Authorization: Bearer <CRON_SECRET> header when CRON_SECRET
 * is set as a project env var. If unset, the route is open (acceptable for the
 * demo).
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { db } from "@/lib/db";
import { loadKeypairFromBase58 } from "@/lib/solana/connection";
import {
  createEscrow,
  bindWorker,
  releaseToWorker,
  newTaskNonce,
  taskNonceToHex,
} from "@/lib/solana/escrow-client";
import { buildSubmissionMessage } from "@/lib/auth/wallet-signature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = req.headers.get("authorization");
    if (got !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const demoWorker = loadKeypairFromBase58(process.env.DEMO_WORKER_SECRET_BASE58 ?? "");
    const agent = await db.agent.findFirst({ orderBy: { createdAt: "asc" } });
    if (!agent) return NextResponse.json({ skipped: "no agent" });
    const agentKeypair = loadKeypairFromBase58(agent.walletSecret);

    const bounty = 0.1;
    const stamp = new Date().toISOString().slice(0, 16);
    const nonce = newTaskNonce();
    const { signature: fundingSig, escrowPda } = await createEscrow({
      agentKeypair,
      bountyUsdc: bounty,
      taskNonce: nonce,
    });

    const task = await db.task.create({
      data: {
        agentId: agent.id,
        title: `Heartbeat · ${stamp}`,
        description: "Automated heartbeat task. One-word reply required.",
        acceptanceCriteriaJson: JSON.stringify({ accept_any_of: ["ok"] }),
        bountyUsdc: bounty,
        verificationMethod: "text_response",
        deadlineAt: new Date(Date.now() + 60 * 60 * 1000),
        status: "open",
        escrowPda: escrowPda.toBase58(),
        escrowFundedTxSig: fundingSig,
        taskNonce: taskNonceToHex(nonce),
      },
    });

    const bindTx = await bindWorker({ taskNonce: nonce, workerPubkey: demoWorker.publicKey });
    await db.worker.upsert({
      where: { walletAddress: demoWorker.publicKey.toBase58() },
      update: {},
      create: { walletAddress: demoWorker.publicKey.toBase58(), displayName: "Demo Worker" },
    });
    await db.task.update({
      where: { id: task.id },
      data: { status: "claimed", claimedByWallet: demoWorker.publicKey.toBase58(), claimedAt: new Date(), bindTxSig: bindTx },
    });

    const payload = { text: "ok" };
    const dataString = JSON.stringify(payload);
    const payloadHash = createHash("sha256").update(dataString).digest("hex");
    const submitMsg = buildSubmissionMessage(task.id, payloadHash);
    const submitSigBytes = nacl.sign.detached(new TextEncoder().encode(submitMsg), demoWorker.secretKey);
    await db.submission.create({
      data: { taskId: task.id, workerWallet: demoWorker.publicKey.toBase58(), submissionData: dataString, signature: bs58.encode(submitSigBytes) },
    });
    await db.task.update({
      where: { id: task.id },
      data: { status: "submitted", submittedAt: new Date(), submissionDataJson: dataString },
    });

    const payoutTx = await releaseToWorker({ taskNonce: nonce, workerPubkey: demoWorker.publicKey });
    await db.task.update({ where: { id: task.id }, data: { status: "paid", payoutTxSig: payoutTx } });
    await db.worker.update({
      where: { walletAddress: demoWorker.publicKey.toBase58() },
      data: { completedCount: { increment: 1 }, totalEarnedUsdc: { increment: bounty } },
    });

    return NextResponse.json({
      ok: true,
      task_id: task.id,
      funding_tx: fundingSig,
      bind_tx: bindTx,
      payout_tx: payoutTx,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
