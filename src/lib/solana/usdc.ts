import {
  Connection,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  Signer,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { USDC_MINT, USDC_DECIMALS } from "@/lib/constants";

export function usdcToLamports(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
}
export function lamportsToUsdc(amount: bigint | number): number {
  const n = typeof amount === "bigint" ? Number(amount) : amount;
  return n / 10 ** USDC_DECIMALS;
}

export async function getUsdcAta(owner: PublicKey): Promise<PublicKey> {
  return getAssociatedTokenAddress(USDC_MINT, owner, true);
}

export async function ensureUsdcAta(
  connection: Connection,
  payer: Signer,
  owner: PublicKey,
): Promise<PublicKey> {
  const account = await getOrCreateAssociatedTokenAccount(connection, payer, USDC_MINT, owner, true);
  return account.address;
}

export async function getUsdcBalance(connection: Connection, owner: PublicKey): Promise<number> {
  try {
    const ata = await getUsdcAta(owner);
    const acc = await getAccount(connection, ata);
    return lamportsToUsdc(acc.amount);
  } catch {
    return 0;
  }
}
