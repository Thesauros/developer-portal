"use client";
import { useState } from "react";
import {
  getDefaultConfig,
  RainbowKitProvider,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import { WagmiProvider, http } from "wagmi";
import { arbitrum, base, monad, plasma } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { walletProjectId } from "./project";
import "@rainbow-me/rainbowkit/styles.css";
const config = getDefaultConfig({
  appName: "Thesauros",
  projectId:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || walletProjectId,
  chains: [arbitrum, base, monad, plasma],
  transports: {
    [arbitrum.id]: http(),
    [base.id]: http(),
    [monad.id]: http("https://rpc1.monad.xyz"),
    [plasma.id]: http("https://rpc.plasma.to"),
  },
  ssr: true,
});
const theme = lightTheme({
  accentColor: "#173d5e",
  accentColorForeground: "white",
  borderRadius: "medium",
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
