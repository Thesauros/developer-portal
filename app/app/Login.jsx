"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import AccessShell from "./AccessShell";
import s from "./login.module.css";
const WalletAccess = dynamic(() => import("./wallet/WalletAccess"), {
  ssr: false,
  loading: () => (
    <button className={s.walletConnectButton} disabled>
      Opening wallets…
    </button>
  ),
});
export default function Login({ next = "", mode = "individual" }) {
  const [ready, setReady] = useState(false);
  return (
    <AccessShell institution={mode === "institution"}>
      <h1>Sign in with your wallet</h1>
      <p className={s.intro}>
        {mode === "institution"
          ? "Explore Thesauros vaults, review protocol activity and find the integration resources for your product. Try the Earn flow from the same workspace."
          : "Deposit USDC into Earn, follow your position and withdraw to your wallet."}
      </p>
      {ready ? (
        <WalletAccess next={next} mode={mode} />
      ) : (
        <button
          className={s.walletConnectButton}
          onClick={() => setReady(true)}
        >
          Connect wallet
        </button>
      )}
      <p className={s.walletHint}>
        Connect a wallet, then sign the message to continue.
      </p>
      <div className={s.accessNote}>
        The sign-in message confirms your wallet ownership. It does not move
        funds or grant token approvals.
      </div>
    </AccessShell>
  );
}
