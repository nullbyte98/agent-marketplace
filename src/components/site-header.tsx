"use client";
import Link from "next/link";
import { WalletButton } from "@/components/wallet-button";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <nav className="flex min-w-0 items-center gap-3 sm:gap-6">
          <Link href="/" className="shrink-0 text-sm font-semibold">Agent Marketplace</Link>
          <Link href="/tasks" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline">Browse</Link>
          <Link href="/dashboard" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline">Dashboard</Link>
          <Link href="/docs" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline">Agent API</Link>
        </nav>
        <WalletButton />
      </div>
    </header>
  );
}
