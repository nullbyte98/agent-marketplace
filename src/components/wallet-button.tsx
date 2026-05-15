"use client";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";

export function WalletButton() {
  const { connected, publicKey } = useWallet();
  return (
    <div className="flex items-center gap-3">
      {connected && publicKey && (
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
        </span>
      )}
      <WalletMultiButton style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", borderRadius: "0.375rem", height: "2.5rem", fontSize: "0.875rem", lineHeight: "1.25rem" }} />
    </div>
  );
}
