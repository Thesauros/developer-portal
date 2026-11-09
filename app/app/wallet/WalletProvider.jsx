"use client";
import { useState } from "react";
import {
  getDefaultConfig,
  RainbowKitProvider,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import { WagmiProvider, http } from "wagmi";
import { chainList } from "../../../lib/chains.mjs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { walletProjectId } from "./project";
import "@rainbow-me/rainbowkit/styles.css";
const config = getDefaultConfig({
  appName: "Thesauros",
  projectId:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || walletProjectId,
  // Every network the vaults run on, from the one registry: a vault on a new
  // network can be reached from the wallet without touching this file.
  chains: chainList.map((chain) => chain.chain),
  transports: Object.fromEntries(
    chainList.map((chain) => [chain.chainId, http(chain.read[0])]),
  ),
  ssr: true,
});
const theme = lightTheme({
  accentColor: "#196aff",
  accentColorForeground: "white",
  borderRadius: "large",
  fontStack: "system",
  overlayBlur: "small",
});
theme.fonts.body = "Onest, var(--font-sans), sans-serif";
export function WalletTheme({ children }) {
  return (
    <RainbowKitProvider theme={theme} modalSize="compact" locale="en-US">
      {children}
    </RainbowKitProvider>
  );
}
export default function WalletProvider({ children }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false } },
      }),
  );
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
