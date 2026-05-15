import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { SOLANA_RPC_URL } from "@/lib/constants";

export function getConnection(): Connection {
  return new Connection(SOLANA_RPC_URL, "confirmed");
}

// The backend's platform keypair. Authority on every escrow PDA. Loaded from
// PLATFORM_KEYPAIR_BASE58, which is base58 of the 64-byte secret key.
let cachedPlatform: Keypair | null = null;
export function getPlatformKeypair(): Keypair {
  if (cachedPlatform) return cachedPlatform;
  const secret = process.env.PLATFORM_KEYPAIR_BASE58;
  if (!secret) {
    throw new Error(
      "PLATFORM_KEYPAIR_BASE58 not set. Generate one and copy it into .env. See README.",
    );
  }
  cachedPlatform = Keypair.fromSecretKey(bs58.decode(secret));
  return cachedPlatform;
}

export function loadKeypairFromBase58(secretBase58: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(secretBase58));
}
