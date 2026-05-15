import { z } from "zod";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { json, error, notFound } from "@/lib/api-helpers";
import { buildSubmissionMessage, verifyWalletSignature } from "@/lib/auth/wallet-signature";

const Body = z.object({
  wallet_address: z.string(),
  submission_data: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]),
  signature: z.string(), // base58 ed25519 over buildSubmissionMessage(task_id, payload_hash)
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return error("Invalid body");
  const { wallet_address, submission_data, signature } = parse.data;

  const task = await db.task.findUnique({ where: { id: params.id } });
  if (!task) return notFound("Task not found");
  if (task.status !== "claimed") return error(`Task is ${task.status}, not claimed`, 409);
  if (task.claimedByWallet !== wallet_address) return error("Only the claimer may submit", 403);

  const dataString = typeof submission_data === "string" ? submission_data : JSON.stringify(submission_data);
  const payloadHash = createHash("sha256").update(dataString).digest("hex");
  const message = buildSubmissionMessage(task.id, payloadHash);
  const valid = verifyWalletSignature({ message, signatureBase58: signature, walletPubkey: wallet_address });
  if (!valid) return error("Wallet signature does not verify against the submission payload", 403);

  const [submission, updated] = await db.$transaction([
    db.submission.create({
      data: {
        taskId: task.id,
        workerWallet: wallet_address,
        submissionData: dataString,
        signature,
      },
    }),
    db.task.update({
      where: { id: task.id },
      data: { status: "submitted", submittedAt: new Date(), submissionDataJson: dataString },
    }),
  ]);

  return json({ ok: true, submission_id: submission.id, status: updated.status });
}
