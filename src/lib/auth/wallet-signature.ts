import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

/**
 * Verify a base58-encoded ed25519 signature against a UTF-8 message and the
 * claimed signer's pubkey. Used to prove a worker authored a submission.
 */
export function verifyWalletSignature(params: {
  message: string;
  signatureBase58: string;
  walletPubkey: string;
}): boolean {
  try {
    const { message, signatureBase58, walletPubkey } = params;
    const msg = new TextEncoder().encode(message);
    const sig = bs58.decode(signatureBase58);
    const key = new PublicKey(walletPubkey).toBytes();
    return nacl.sign.detached.verify(msg, sig, key);
  } catch {
    return false;
  }
}

/** Canonical message format the frontend asks Phantom to sign on submission. */
export function buildSubmissionMessage(taskId: string, payloadHash: string): string {
  return `agent-marketplace.submission\ntask:${taskId}\npayload:${payloadHash}`;
}

/** Canonical message Phantom signs to claim a task. Prevents claiming under
 *  someone else's wallet address. */
export function buildClaimMessage(taskId: string, walletAddress: string): string {
  return `agent-marketplace.claim\ntask:${taskId}\nwallet:${walletAddress}`;
}
