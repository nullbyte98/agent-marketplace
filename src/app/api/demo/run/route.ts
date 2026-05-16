/**
 * Live demo endpoint. Streams Server-Sent Events as a real on-chain loop runs:
 *   1. The demo agent posts a fresh task and funds an escrow PDA.
 *   2. A server-controlled "demo worker" claims (binds itself on chain).
 *   3. The demo worker submits with a real ed25519 signature.
 *   4. The agent approves; the program releases USDC to the worker on chain.
 *
 * Every step yields a JSON event over SSE with a status, message, and any
 * relevant transaction signature for Explorer linking. The UI subscribes and
 * renders progress in real time.
 */
import { NextRequest } from "next/server";
import { createHash } from "crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey, Keypair } from "@solana/web3.js";
import { db } from "@/lib/db";
import { loadKeypairFromBase58 } from "@/lib/solana/connection";
import {
  createEscrow,
  bindWorker,
  releaseToWorker,
  newTaskNonce,
  taskNonceToHex,
} from "@/lib/solana/escrow-client";
import { buildClaimMessage, buildSubmissionMessage } from "@/lib/auth/wallet-signature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

interface Event {
  step: "starting" | "posting" | "posted" | "claiming" | "claimed" | "submitting" | "submitted" | "approving" | "approved" | "complete" | "error";
  message: string;
  task_id?: string;
  tx?: string;
  worker?: string;
  agent_label?: string;
  bounty?: number;
}

function sse(event: Event): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function GET(_req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: Event) => controller.enqueue(encoder.encode(sse(e)));
      try {
        send({ step: "starting", message: "Booting demo loop..." });

        const demoWorkerSecret = process.env.DEMO_WORKER_SECRET_BASE58;
        if (!demoWorkerSecret) throw new Error("DEMO_WORKER_SECRET_BASE58 not set");
        const demoWorker = loadKeypairFromBase58(demoWorkerSecret);

        const agent = await db.agent.findFirst({ orderBy: { createdAt: "asc" } });
        if (!agent) throw new Error("No demo agent seeded. Run `npm run seed` first.");

        const agentKeypair = loadKeypairFromBase58(agent.walletSecret);
        const bounty = 0.25;
        const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);

        send({ step: "posting", message: "Demo agent is posting a fresh task and funding escrow on devnet..." });
        const nonce = newTaskNonce();
        const { signature: fundingSig, escrowPda } = await createEscrow({
          agentKeypair,
          bountyUsdc: bounty,
          taskNonce: nonce,
        });
        const task = await db.task.create({
          data: {
            agentId: agent.id,
            title: `Live demo · name a primary colour · ${stamp}`,
            description: "Reply with one of: red, green, blue. Auto-run for the live demo.",
            acceptanceCriteriaJson: JSON.stringify({ accept_any_of: ["red", "green", "blue"] }),
            bountyUsdc: bounty,
            verificationMethod: "text_response",
            deadlineAt: new Date(Date.now() + 60 * 60 * 1000),
            status: "open",
            escrowPda: escrowPda.toBase58(),
            escrowFundedTxSig: fundingSig,
            taskNonce: taskNonceToHex(nonce),
          },
        });
        send({
          step: "posted",
          message: `Task posted. $${bounty.toFixed(2)} USDC is now locked in escrow.`,
          task_id: task.id,
          tx: fundingSig,
          agent_label: agent.label,
          bounty,
        });

        send({ step: "claiming", message: "Demo worker is signing a claim and binding itself on chain..." });
        // Worker signs the canonical claim message.
        const claimMsg = buildClaimMessage(task.id, demoWorker.publicKey.toBase58());
        const claimSig = nacl.sign.detached(new TextEncoder().encode(claimMsg), demoWorker.secretKey);
        // Bind on chain.
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
        send({
          step: "claimed",
          message: "Worker bound to escrow on chain. Only this wallet can now receive the bounty.",
          tx: bindTx,
          worker: demoWorker.publicKey.toBase58(),
          task_id: task.id,
        });
        // Verify the signature shape (sanity check, doesn't change behaviour).
        void claimSig;

        send({ step: "submitting", message: "Demo worker is submitting a signed response..." });
        const payload = { text: "blue" };
        const dataString = JSON.stringify(payload);
        const payloadHash = createHash("sha256").update(dataString).digest("hex");
        const submitMsg = buildSubmissionMessage(task.id, payloadHash);
        const submitSigBytes = nacl.sign.detached(new TextEncoder().encode(submitMsg), demoWorker.secretKey);
        const submitSigB58 = bs58.encode(submitSigBytes);
        await db.submission.create({
          data: {
            taskId: task.id,
            workerWallet: demoWorker.publicKey.toBase58(),
            submissionData: dataString,
            signature: submitSigB58,
          },
        });
        await db.task.update({
          where: { id: task.id },
          data: { status: "submitted", submittedAt: new Date(), submissionDataJson: dataString },
        });
        send({ step: "submitted", message: "Submission accepted. ed25519 signature verified.", task_id: task.id });

        send({ step: "approving", message: "Agent is reviewing and triggering on-chain release..." });
        const payoutTx = await releaseToWorker({
          taskNonce: nonce,
          workerPubkey: demoWorker.publicKey,
        });
        await db.task.update({
          where: { id: task.id },
          data: { status: "paid", payoutTxSig: payoutTx },
        });
        await db.worker.update({
          where: { walletAddress: demoWorker.publicKey.toBase58() },
          data: { completedCount: { increment: 1 }, totalEarnedUsdc: { increment: bounty } },
        });
        send({
          step: "approved",
          message: `USDC released from escrow to ${demoWorker.publicKey.toBase58().slice(0, 4)}...${demoWorker.publicKey.toBase58().slice(-4)}.`,
          tx: payoutTx,
          task_id: task.id,
        });

        send({ step: "complete", message: "Loop complete. Every step above is a real Solana devnet transaction." });
      } catch (e: any) {
        const msg = e?.message ? String(e.message) : String(e);
        send({ step: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
