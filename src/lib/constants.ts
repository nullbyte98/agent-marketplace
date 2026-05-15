import { PublicKey } from "@solana/web3.js";

// Devnet USDC, per the brief.
export const USDC_MINT = new PublicKey(
  process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

// USDC has 6 decimals on Solana.
export const USDC_DECIMALS = 6;

// Anchor program ID. Updated after the first `anchor deploy`.
export const ESCROW_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ?? "CZD9e8HA3nuirtb1AgQ7wv4nFYgELjnhAS7PXwDzmZCC"
);

export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  process.env.SOLANA_RPC_URL ??
  "https://api.devnet.solana.com";

export const ADMIN_WALLET_PUBKEY = process.env.ADMIN_WALLET_PUBKEY ?? "";

export const VERIFICATION_METHODS = [
  "photo_proof",
  "signed_document",
  "text_response",
  "url_submission",
  "llm_judged",
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const TASK_STATUSES = [
  "open",
  "claimed",
  "submitted",
  "approved",
  "paid",
  "expired",
  "disputed",
  "refunded",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
