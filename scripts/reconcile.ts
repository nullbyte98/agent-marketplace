/**
 * Reconciliation script. Walks all non-terminal tasks in the DB, fetches their
 * EscrowState from chain, and reports any drift between DB status and on-chain
 * status. Optionally heals the DB by promoting "claimed" / "submitted" /
 * "disputed" rows to "paid" or "refunded" if the chain shows the funds have
 * already moved.
 *
 * Why: the DB write happens AFTER the on-chain tx in our routes. If the chain
 * tx succeeds but the DB update fails (server crashes, network drops), the
 * worker has been paid but the app still thinks the task is unpaid. This
 * script reads chain truth and corrects the DB.
 *
 * Run:   npx tsx scripts/reconcile.ts            (report-only)
 *        npx tsx scripts/reconcile.ts --apply    (apply healings)
 *
 * Safe to re-run. Read-only by default.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { PrismaClient } from "@prisma/client";

const ROOT = path.resolve(__dirname, "..");
const IDL_PATH = path.join(ROOT, "src/lib/solana/idl.json");

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ?? "CZD9e8HA3nuirtb1AgQ7wv4nFYgELjnhAS7PXwDzmZCC",
);

const STATUS_NAMES = ["Funded", "Released", "Refunded"];

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "MODE: --apply (healing enabled)" : "MODE: report-only (use --apply to heal)");

  const connection = new Connection(RPC, "confirmed");
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  // Read-only provider: no signer needed for account fetches.
  const provider = new anchor.AnchorProvider(
    connection,
    { publicKey: PublicKey.default, signTransaction: async (t: any) => t, signAllTransactions: async (t: any[]) => t } as any,
    { commitment: "confirmed" },
  );
  const program = new anchor.Program(idl, provider);

  const prisma = new PrismaClient();
  const tasks = await prisma.task.findMany({
    where: { status: { in: ["open", "claimed", "submitted", "disputed"] } },
    include: { agent: true },
  });
  console.log(`Found ${tasks.length} non-terminal task(s) to inspect.`);

  let drifted = 0, healed = 0, missing = 0;
  for (const task of tasks) {
    const escrowPda = new PublicKey(task.escrowPda);
    let onchain: any;
    try {
      onchain = await program.account.escrowState.fetch(escrowPda);
    } catch (e: any) {
      missing++;
      console.warn(`  [missing] ${task.id} "${task.title}" escrow ${task.escrowPda} not found on chain`);
      continue;
    }

    const onchainStatus = STATUS_NAMES[onchain.status] ?? `Unknown(${onchain.status})`;
    const dbStatus = task.status;
    const expectedTerminal =
      onchainStatus === "Released" ? "paid" :
      onchainStatus === "Refunded" ? "refunded" :
      null;

    if (expectedTerminal && dbStatus !== expectedTerminal) {
      drifted++;
      console.log(`  [drift] ${task.id} "${task.title}": db=${dbStatus} chain=${onchainStatus} -> should be ${expectedTerminal}`);
      if (apply) {
        await prisma.task.update({
          where: { id: task.id },
          data: { status: expectedTerminal },
        });
        // Worker stats catch-up if released.
        if (expectedTerminal === "paid" && task.claimedByWallet) {
          await prisma.worker.upsert({
            where: { walletAddress: task.claimedByWallet },
            update: { completedCount: { increment: 1 }, totalEarnedUsdc: { increment: task.bountyUsdc } },
            create: {
              walletAddress: task.claimedByWallet,
              completedCount: 1,
              totalEarnedUsdc: task.bountyUsdc,
            },
          });
        }
        healed++;
      }
    } else if (onchainStatus === "Funded" && dbStatus === "claimed" && onchain.worker.equals(PublicKey.default)) {
      // DB thinks claimed, chain shows no worker bound. Possible mid-flight failure.
      drifted++;
      console.log(`  [drift] ${task.id} db=claimed but no worker bound on chain`);
    } else {
      console.log(`  [ok] ${task.id} db=${dbStatus} chain=${onchainStatus}`);
    }
  }

  console.log(`\nSummary: ${tasks.length} inspected, ${drifted} drifted, ${healed} healed, ${missing} missing on chain.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
