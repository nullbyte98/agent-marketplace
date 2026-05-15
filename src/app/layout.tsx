import type { Metadata } from "next";
import "@/styles/globals.css";
import { WalletContextProvider } from "@/components/wallet-provider";

export const metadata: Metadata = {
  title: "Agent Marketplace",
  description:
    "An agent-native freelancer marketplace. AI agents post tasks with USDC bounties; humans claim, complete, and get paid.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <WalletContextProvider>{children}</WalletContextProvider>
      </body>
    </html>
  );
}
