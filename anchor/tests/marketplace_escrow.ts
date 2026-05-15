// Anchor test for marketplace_escrow.
//
// Covers the three core paths:
//   1. create_escrow funds the vault from the agent's USDC account.
//   2. release_to_worker moves the bounty out to a worker's USDC account.
//   3. refund_to_agent moves the bounty back to the agent (separate task).
//
// Uses a freshly minted SPL token to stand in for devnet USDC. Same instruction
// surface, so the test does not depend on devnet liquidity.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { randomBytes } from "crypto";
import { assert } from "chai";
import { MarketplaceEscrow } from "../target/types/marketplace_escrow";

describe("marketplace_escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MarketplaceEscrow as Program<MarketplaceEscrow>;
  const payer = (provider.wallet as anchor.Wallet).payer;

  let mint: PublicKey;
  let agent: Keypair;
  let worker: Keypair;
  let authority: Keypair;
  let agentAta: PublicKey;
  let workerAta: PublicKey;

  const BOUNTY = 5_000_000n; // 5 USDC with 6 decimals

  before(async () => {
    agent = Keypair.generate();
    worker = Keypair.generate();
    authority = Keypair.generate();

    // Fresh local validators do not pre-fund the provider wallet. Airdrop the
    // payer, then the test keypairs, and wait until balances are visible.
    async function airdropAndWait(pubkey: PublicKey, sol: number) {
      const sig = await provider.connection.requestAirdrop(pubkey, sol * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig, "confirmed");
      for (let i = 0; i < 30; i++) {
        const bal = await provider.connection.getBalance(pubkey, "confirmed");
        if (bal > 0) return bal;
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error(`airdrop to ${pubkey.toBase58()} did not land`);
    }
    await airdropAndWait(payer.publicKey, 10);
    await airdropAndWait(agent.publicKey, 2);
    await airdropAndWait(worker.publicKey, 2);
    await airdropAndWait(authority.publicKey, 2);

    mint = await createMint(provider.connection, payer, payer.publicKey, null, 6);

    agentAta = await createAssociatedTokenAccount(provider.connection, agent, mint, agent.publicKey);
    workerAta = await createAssociatedTokenAccount(provider.connection, worker, mint, worker.publicKey);

    await mintTo(provider.connection, payer, mint, agentAta, payer, 100_000_000); // 100 mock-USDC
  });

  function pdas(nonce: Buffer) {
    const [escrowState] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), nonce],
      program.programId,
    );
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), nonce],
      program.programId,
    );
    return { escrowState, vault };
  }

  it("create_escrow funds the vault", async () => {
    const nonce = randomBytes(32);
    const { escrowState, vault } = pdas(nonce);

    await program.methods
      .createEscrow([...nonce] as any, new anchor.BN(BOUNTY.toString()))
      .accounts({
        agent: agent.publicKey,
        authority: authority.publicKey,
        escrowState,
        escrowTokenAccount: vault,
        agentTokenAccount: agentAta,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([agent])
      .rpc();

    const vaultAcc = await getAccount(provider.connection, vault);
    assert.equal(vaultAcc.amount.toString(), BOUNTY.toString(), "vault funded with bounty");

    const state = await program.account.escrowState.fetch(escrowState);
    assert.equal(state.bounty.toString(), BOUNTY.toString());
    assert.equal(state.status, 0, "status = Funded");
    assert.ok(state.authority.equals(authority.publicKey));
  });

  async function createAndBind(nonce: Buffer, workerPubkey: PublicKey) {
    const { escrowState, vault } = pdas(nonce);
    await program.methods
      .createEscrow([...nonce] as any, new anchor.BN(BOUNTY.toString()))
      .accounts({
        agent: agent.publicKey,
        authority: authority.publicKey,
        escrowState,
        escrowTokenAccount: vault,
        agentTokenAccount: agentAta,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([agent])
      .rpc();
    await program.methods
      .bindWorker(workerPubkey)
      .accounts({ authority: authority.publicKey, escrowState })
      .signers([authority])
      .rpc();
    return { escrowState, vault };
  }

  it("release_to_worker pays the bound worker", async () => {
    const nonce = randomBytes(32);
    const { escrowState, vault } = await createAndBind(nonce, worker.publicKey);

    const before = await getAccount(provider.connection, workerAta);
    await program.methods
      .releaseToWorker()
      .accounts({
        authority: authority.publicKey,
        escrowState,
        escrowTokenAccount: vault,
        workerTokenAccount: workerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    const after = await getAccount(provider.connection, workerAta);
    assert.equal((after.amount - before.amount).toString(), BOUNTY.toString(), "worker received bounty");

    const state = await program.account.escrowState.fetch(escrowState);
    assert.equal(state.status, 1, "status = Released");
    assert.ok(state.worker.equals(worker.publicKey), "stored worker matches");
  });

  it("release fails when no worker has been bound", async () => {
    const nonce = randomBytes(32);
    const { escrowState, vault } = pdas(nonce);
    await program.methods
      .createEscrow([...nonce] as any, new anchor.BN(BOUNTY.toString()))
      .accounts({
        agent: agent.publicKey, authority: authority.publicKey, escrowState,
        escrowTokenAccount: vault, agentTokenAccount: agentAta, mint,
        tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([agent]).rpc();

    let failed = false;
    try {
      await program.methods.releaseToWorker().accounts({
        authority: authority.publicKey, escrowState, escrowTokenAccount: vault,
        workerTokenAccount: workerAta, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([authority]).rpc();
    } catch (e: any) {
      failed = true;
      assert.match(e.message, /WorkerNotBound/);
    }
    assert.isTrue(failed, "expected release without bound worker to fail");
  });

  it("release fails when worker token account belongs to a different worker", async () => {
    const nonce = randomBytes(32);
    const intruder = Keypair.generate();
    const airdrop = await provider.connection.requestAirdrop(intruder.publicKey, anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdrop, "confirmed");
    const intruderAta = await createAssociatedTokenAccount(provider.connection, intruder, mint, intruder.publicKey);

    const { escrowState, vault } = await createAndBind(nonce, worker.publicKey);

    let failed = false;
    try {
      await program.methods.releaseToWorker().accounts({
        authority: authority.publicKey, escrowState, escrowTokenAccount: vault,
        workerTokenAccount: intruderAta, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([authority]).rpc();
    } catch (e: any) {
      failed = true;
      assert.match(e.message, /WorkerMismatch/);
    }
    assert.isTrue(failed, "expected release to wrong recipient to fail");
  });

  it("bind_worker rejects re-binding once a worker is set", async () => {
    const nonce = randomBytes(32);
    const { escrowState } = await createAndBind(nonce, worker.publicKey);
    let failed = false;
    try {
      await program.methods.bindWorker(Keypair.generate().publicKey)
        .accounts({ authority: authority.publicKey, escrowState })
        .signers([authority]).rpc();
    } catch (e: any) {
      failed = true;
      assert.match(e.message, /WorkerAlreadyBound/);
    }
    assert.isTrue(failed, "expected re-bind to fail");
  });

  it("refund_to_agent pays the agent back", async () => {
    const nonce = randomBytes(32);
    const { escrowState, vault } = pdas(nonce);

    await program.methods
      .createEscrow([...nonce] as any, new anchor.BN(BOUNTY.toString()))
      .accounts({
        agent: agent.publicKey,
        authority: authority.publicKey,
        escrowState,
        escrowTokenAccount: vault,
        agentTokenAccount: agentAta,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([agent])
      .rpc();

    const before = await getAccount(provider.connection, agentAta);

    await program.methods
      .refundToAgent()
      .accounts({
        authority: authority.publicKey,
        escrowState,
        escrowTokenAccount: vault,
        agentTokenAccount: agentAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    const after = await getAccount(provider.connection, agentAta);
    assert.equal(
      (after.amount - before.amount).toString(),
      BOUNTY.toString(),
      "agent refunded",
    );

    const state = await program.account.escrowState.fetch(escrowState);
    assert.equal(state.status, 2, "status = Refunded");
  });

  it("release fails when caller is not authority", async () => {
    const nonce = randomBytes(32);
    const { escrowState, vault } = pdas(nonce);

    await program.methods
      .createEscrow([...nonce] as any, new anchor.BN(BOUNTY.toString()))
      .accounts({
        agent: agent.publicKey,
        authority: authority.publicKey,
        escrowState,
        escrowTokenAccount: vault,
        agentTokenAccount: agentAta,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([agent])
      .rpc();

    const imposter = Keypair.generate();
    const airdrop = await provider.connection.requestAirdrop(imposter.publicKey, anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdrop);

    let failed = false;
    try {
      await program.methods
        .releaseToWorker()
        .accounts({
          authority: imposter.publicKey,
          escrowState,
          escrowTokenAccount: vault,
          workerTokenAccount: workerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([imposter])
        .rpc();
    } catch (e: any) {
      failed = true;
      assert.match(e.message, /Unauthorized/, "must reject non-authority signer");
    }
    assert.isTrue(failed, "expected unauthorized release to fail");
  });
});
