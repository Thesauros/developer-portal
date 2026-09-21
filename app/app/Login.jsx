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
export default function Login({ next = "" }) {
  const [ready, setReady] = useState(false);
  return (
    <AccessShell>
      <span className={s.eyebrow}>Your Thesauros account</span>
      <h1>
        Your wallet.
        <br />
        Your way in.
      </h1>
      <p className={s.intro}>
        Connect your wallet to explore Earn, follow the markets and try your
        first test deposit.
      </p>
      <div className={s.walletEmblem} aria-hidden="true">
        <svg width="33" height="33" viewBox="0 0 32 32" fill="none">
          <rect
            x="5"
            y="8"
            width="23"
            height="19"
            rx="5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M6 10V7a3 3 0 0 1 3-3h13v4M28 15h-6a3 3 0 0 0 0 6h6"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="22" cy="18" r="1" fill="currentColor" />
        </svg>
      </div>
      {ready ? (
        <WalletAccess next={next} />
      ) : (
        <button
          className={s.walletConnectButton}
          onClick={() => setReady(true)}
        >
          Connect wallet
        </button>
      )}
      <p className={s.walletHint}>
        MetaMask, Rainbow and WalletConnect.
        <br />
        Confirm a sign-in message to access your account.
      </p>
      <div className={s.accessNote}>
        The sign-in message confirms your wallet ownership. It does not move
        funds or grant token approvals.
      </div>
    </AccessShell>
  );
}
