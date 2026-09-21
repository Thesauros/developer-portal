"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import WalletProvider, { WalletTheme } from "./WalletProvider";
import ProductApp from "../ProductApp";
import BrandLoading from "../../ui/BrandLoading";
function SessionGuard({ user }) {
  const { address, status } = useAccount();
  const connected = useRef(false);
  const [leaving, setLeaving] = useState(false),
    [failed, setFailed] = useState(false);
  const mismatch =
    address && address.toLowerCase() !== user.walletAddress.toLowerCase();
  useEffect(() => {
    if (status === "connected") connected.current = true;
    if (mismatch || (connected.current && status === "disconnected")) {
      setLeaving(true);
      fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
        .then((r) => {
          if (!r.ok) throw new Error();
          location.replace("/app/individual");
        })
        .catch(() => {
          setFailed(true);
        });
    }
  }, [mismatch, status]);
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
  return <ProductApp mode="individual" user={user} />;
}
export default function Workspace({ user }) {
  return (
    <WalletProvider>
      <WalletTheme>
        <SessionGuard user={user} />
      </WalletTheme>
    </WalletProvider>
  );
}
