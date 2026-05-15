/**
 * Seed script. Idempotent-ish: creates a platform keypair, admin keypair, a
 * fresh devnet SPL token to stand in for USDC, mints some to a fresh sample
 * agent, then posts 3 demo tasks that fund on-chain escrow PDAs.
 *
 * Why a fresh mint? Real Circle devnet USDC cannot be minted by us. For the
 * demo we deploy our own 6-decimal SPL token and treat it as "Devnet USDC".
 * The .env USDC_MINT is overwritten so the rest of the app uses the new mint.
 *
 * Run: npm run seed
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import bs58 from "bs58";
import * as os from "os";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { PrismaClient } from "@prisma/client";
import * as anchor from "@coral-xyz/anchor";
import { randomBytes, createHash } from "crypto";

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const IDL_PATH = path.join(ROOT, "src/lib/solana/idl.json");
const KEYS_DIR = path.join(ROOT, "scripts/.keys");

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ?? "CZD9e8HA3nuirtb1AgQ7wv4nFYgELjnhAS7PXwDzmZCC",
);

function loadOrCreateKp(file: string): Keypair {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const p = path.join(KEYS_DIR, file);
  if (fs.existsSync(p)) {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

function patchEnv(updates: Record<string, string>) {
  let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  for (const [k, v] of Object.entries(updates)) {
    const line = `${k}="${v}"`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : text + (text.endsWith("\n") ? "" : "\n") + line + "\n";
  }
  fs.writeFileSync(ENV_PATH, text);
}

function loadLocalCliKeypair(): Keypair | null {
  // Solana CLI's keypair path can be overridden in ~/.config/solana/cli/config.yml.
  // Parse it so we use the keypair that actually has SOL.
  const cfgPath = path.join(os.homedir(), ".config/solana/cli/config.yml");
  let keypairPath = path.join(os.homedir(), ".config/solana/id.json");
  if (fs.existsSync(cfgPath)) {
    const m = fs.readFileSync(cfgPath, "utf8").match(/keypair_path:\s*(\S+)/);
    if (m) keypairPath = m[1].replace(/^~/, os.homedir());
  }
  if (!fs.existsSync(keypairPath)) return null;
  const raw = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function fundFrom(funder: Keypair, connection: Connection, pubkey: PublicKey, minSol: number, sendSol: number) {
  const bal = await connection.getBalance(pubkey);
  if (bal >= minSol * LAMPORTS_PER_SOL) return bal;
  // Try faucet airdrop first (cheap if it works), then fall back to transfer.
  try {
    const sig = await connection.requestAirdrop(pubkey, sendSol * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    const newBal = await connection.getBalance(pubkey);
    if (newBal >= minSol * LAMPORTS_PER_SOL) {
      console.log(`  airdropped ${sendSol} SOL to ${pubkey.toBase58().slice(0,8)}...`);
      return newBal;
    }
  } catch {}
  console.log(`  faucet skipped; transferring ${sendSol} SOL from local CLI wallet to ${pubkey.toBase58().slice(0,8)}...`);
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: pubkey, lamports: Math.floor(sendSol * LAMPORTS_PER_SOL) }),
  );
  await sendAndConfirmTransaction(connection, tx, [funder], { commitment: "confirmed" });
  return connection.getBalance(pubkey);
}

async function main() {
  console.log("Connecting to", RPC);
  const connection = new Connection(RPC, "confirmed");

  // 1. Platform keypair (authority for all escrows) + admin keypair (for disputes).
  const platform = loadOrCreateKp("platform.json");
  const admin = loadOrCreateKp("admin.json");
  console.log("Platform pubkey:", platform.publicKey.toBase58());
  console.log("Admin    pubkey:", admin.publicKey.toBase58());

  const cliFunder = loadLocalCliKeypair();
  if (!cliFunder) {
    throw new Error("~/.config/solana/id.json not found. Run `solana-keygen new` first.");
  }
  const cliBal = await connection.getBalance(cliFunder.publicKey);
  console.log(`Local CLI wallet ${cliFunder.publicKey.toBase58().slice(0,8)}... has ${(cliBal/LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  if (cliBal < 2 * LAMPORTS_PER_SOL) {
    console.warn("WARNING: local CLI wallet has less than 2 SOL. Fund it via https://faucet.solana.com if seeding fails.");
  }

  await fundFrom(cliFunder, connection, platform.publicKey, 0.5, 1);
  await fundFrom(cliFunder, connection, admin.publicKey, 0.1, 0.3);

  patchEnv({
    PLATFORM_KEYPAIR_BASE58: bs58.encode(platform.secretKey),
    ADMIN_WALLET_PUBKEY: admin.publicKey.toBase58(),
  });

  // 2. Create the demo USDC mint with platform as authority. Mint 6-decimal.
  console.log("Creating demo USDC mint (6 decimals, platform = authority)...");
  const mint = await createMint(connection, platform, platform.publicKey, null, 6);
  console.log("Mint:", mint.toBase58());
  patchEnv({ USDC_MINT: mint.toBase58() });

  // 3. Sample agent.
  const prisma = new PrismaClient();
  const apiKey = "agt_demo_" + randomBytes(16).toString("base64url");
  const apiKeyHash = createHash("sha256")
    .update((process.env.API_KEY_HASH_SALT ?? "change-me-in-production") + apiKey)
    .digest("hex");

  // Wipe existing demo agents for idempotency.
  await prisma.dispute.deleteMany({});
  await prisma.submission.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.agent.deleteMany({});

  const agentKp = Keypair.generate();
  await fundFrom(cliFunder, connection, agentKp.publicKey, 0.2, 0.3);

  // Mint 1000 demo-USDC to the agent.
  const agentAta = await getOrCreateAssociatedTokenAccount(connection, platform, mint, agentKp.publicKey);
  await mintTo(connection, platform, mint, agentAta.address, platform, 1_000_000_000); // 1000 with 6 decimals
  console.log(`Minted 1000 demo-USDC to agent ${agentKp.publicKey.toBase58()}`);

  const agent = await prisma.agent.create({
    data: {
      label: "Demo Agent (research-assistant)",
      apiKeyHash,
      walletAddress: agentKp.publicKey.toBase58(),
      walletSecret: bs58.encode(agentKp.secretKey),
    },
  });

  // 4. Post 3 demo tasks. Fund escrow PDAs on chain.
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  const wallet = new anchor.Wallet(agentKp);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new anchor.Program(idl, provider);

  const samples: Array<{ title: string; description: string; criteria: any; bounty: number; method: string; hours: number }> = [
    {
      title: "Confirm an opening hour for a local cafe",
      description: "Visit the website (or call) for Monmouth Coffee Company, Borough Market, and confirm their Saturday opening hour. Return as text response.",
      criteria: { must_include: ["Monmouth", "Saturday", "open"] },
      bounty: 1.5,
      method: "text_response",
      hours: 48,
    },
    {
      title: "Verify a public GitHub PR is merged",
      description: "Confirm whether https://github.com/anza-xyz/agave/pulls?q=is:pr+is:merged shows at least 5 merged PRs in the last 24 hours. Return a screenshot URL.",
      criteria: { url_must_be: "image hosted publicly", count: ">=5" },
      bounty: 2,
      method: "url_submission",
      hours: 24,
    },
    {
      title: "Summarise one paragraph from a paper",
      description: "Write a 3-sentence plain-English summary of the abstract of arXiv 2310.06825. Will be auto-graded by Claude.",
      criteria: { sentences: 3, must_mention: ["language model", "evaluation"], style: "plain English" },
      bounty: 1,
      method: "llm_judged",
      hours: 72,
    },
  ];

  for (const s of samples) {
    const nonce = randomBytes(32);
    const [statePda] = PublicKey.findProgramAddressSync([Buffer.from("escrow"), nonce], PROGRAM_ID);
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), nonce], PROGRAM_ID);
    const bountyLamports = new anchor.BN(Math.round(s.bounty * 1_000_000));

    console.log(`Posting "${s.title}" with ${s.bounty} USDC escrow...`);
    const sig = await program.methods
      .createEscrow([...nonce] as any, bountyLamports)
      .accounts({
        agent: agentKp.publicKey,
        authority: platform.publicKey,
        escrowState: statePda,
        escrowTokenAccount: vault,
        agentTokenAccount: agentAta.address,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([agentKp])
      .rpc();
    console.log(`  funded tx: ${sig}`);

    await prisma.task.create({
      data: {
        agentId: agent.id,
        title: s.title,
        description: s.description,
        acceptanceCriteriaJson: JSON.stringify(s.criteria),
        bountyUsdc: s.bounty,
        verificationMethod: s.method,
        deadlineAt: new Date(Date.now() + s.hours * 3600 * 1000),
        status: "open",
        escrowPda: statePda.toBase58(),
        escrowFundedTxSig: sig,
        taskNonce: nonce.toString("hex"),
      },
    });

    await prisma.agent.update({
      where: { id: agent.id },
      data: { postedCount: { increment: 1 }, totalSpentUsdc: { increment: s.bounty } },
    });
  }

  console.log("\n========== SEED COMPLETE ==========");
  console.log("Agent API key (SAVE THIS, shown only once):");
  console.log("  " + apiKey);
  console.log("Sample curl to list tasks:");
  console.log(`  curl http://localhost:3000/api/tasks`);
  console.log("Sample curl to post a new task:");
  console.log(`  curl -X POST http://localhost:3000/api/tasks -H "Authorization: Bearer ${apiKey}" -H "content-type: application/json" -d '{"title":"...","description":"...","acceptance_criteria":{},"bounty_amount_usdc":1,"deadline_hours":24,"verification_method":"text_response"}'`);
  console.log("\nUSDC mint:", mint.toBase58());
  console.log("Platform pubkey:", platform.publicKey.toBase58());
  console.log("Admin pubkey  :", admin.publicKey.toBase58());
  console.log("\nRestart your dev server so it picks up the patched .env.");

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
