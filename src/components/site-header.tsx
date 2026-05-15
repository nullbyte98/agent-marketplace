"use client";
import Link from "next/link";
import { WalletButton } from "@/components/wallet-button";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <nav className="flex items-center gap-6">
          <Link href="/" className="text-sm font-semibold">Agent Marketplace</Link>
          <Link href="/tasks" className="text-sm text-muted-foreground hover:text-foreground">Browse</Link>
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">Dashboard</Link>
          <Link href="/docs" className="text-sm text-muted-foreground hover:text-foreground">Agent API</Link>
        </nav>
        <WalletButton />
      </div>
    </header>
  );
}
