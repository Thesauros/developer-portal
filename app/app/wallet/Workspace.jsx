"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import WalletProvider, { WalletTheme } from "./WalletProvider";
import ProductApp from "../ProductApp";
import BrandLoading from "../../ui/BrandLoading";
function SessionGuard({ user, mode }) {
  const { address, status } = useAccount();
  const connected = useRef(false);
  const [leaving, setLeaving] = useState(false),
    [failed, setFailed] = useState(false);
  // Institution accounts sign in with email; a connected wallet only signs
  // transactions, so switching wallets must not end the session.
  const walletSession = user.kind !== "institution";
  const mismatch =
    walletSession &&
    address &&
    address.toLowerCase() !== user.walletAddress?.toLowerCase();
  useEffect(() => {
    if (status === "connected") connected.current = true;
    if (
      mismatch ||
      (walletSession && connected.current && status === "disconnected")
    ) {
      setLeaving(true);
      fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
        .then((r) => {
          if (!r.ok) throw new Error();
          location.replace("/app/" + mode);
        })
        .catch(() => {
          setFailed(true);
        });
    }
  }, [mismatch, status, mode, walletSession]);
  if (failed)
    return (
      <main style={{ padding: "15vh 8vw", color: "#19314a" }}>
        <h1>Your wallet changed.</h1>
        <p>
          We could not close the previous session. Check your connection and try
          again.
        </p>
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    );
  if (leaving || mismatch) return <BrandLoading fullscreen />;
  return <ProductApp mode={mode} user={user} />;
}
export default function Workspace({ user, mode = "individual" }) {
  return (
    <WalletProvider>
      <WalletTheme>
        <SessionGuard user={user} mode={mode} />
      </WalletTheme>
    </WalletProvider>
  );
}
