"use client";
import { useMemo, useState, useEffect, useRef } from "react";
import {
  createAuthenticationAdapter,
  RainbowKitAuthenticationProvider,
  useConnectModal,
  ConnectButton,
} from "@rainbow-me/rainbowkit";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useDisconnect } from "wagmi";
import WalletProvider, { WalletTheme } from "./WalletProvider";
import { workspaceDestination } from "../destination.mjs";
import s from "../login.module.css";
const statement =
  "Sign in to your Thesauros account. This request does not authorize transactions or token spending.";
async function post(path, body) {
  const r = await fetch("/api/auth/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(
      data.message || "Sign-in could not complete. Please try again.",
    );
  return data;
}
function Connect({ busy }) {
  const { openConnectModal } = useConnectModal();
  const { isConnected } = useAccount();
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current && openConnectModal && !isConnected) {
      const frame = requestAnimationFrame(() => {
        opened.current = true;
        openConnectModal();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [openConnectModal, isConnected]);
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openConnectModal,
        openChainModal,
        openAuthenticationModal,
        authenticationStatus,
        mounted,
      }) => {
        const action = !account
          ? openConnectModal
          : chain?.unsupported
            ? openChainModal
            : authenticationStatus !== "authenticated"
              ? openAuthenticationModal
              : undefined;
        return (
          <button
            className={s.walletConnectButton}
            disabled={!mounted || busy}
            onClick={action}
          >
            {busy
              ? "Opening your account…"
              : !account
                ? "Connect wallet"
                : chain?.unsupported
                  ? "Switch network"
                  : "Sign in with wallet"}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
function Access({ next }) {
  const [status, setStatus] = useState("unauthenticated"),
    [error, setError] = useState("");
  const { disconnectAsync } = useDisconnect();
  const adapter = useMemo(
    () =>
      createAuthenticationAdapter({
        getNonce: async () => {
          setError("");
          try {
            return (await post("siwe/nonce", {})).nonce;
          } catch (e) {
            setError(e.message);
            throw e;
          }
        },
        createMessage: ({ nonce, address, chainId }) => {
          const issuedAt = new Date();
          return createSiweMessage({
            domain: location.host,
            uri: location.origin,
            address,
            chainId,
            nonce,
            version: "1",
            statement,
            issuedAt,
            expirationTime: new Date(issuedAt.getTime() + 300_000),
          });
        },
        verify: async ({ message, signature }) => {
          try {
            await post("siwe/verify", { message, signature });
            setStatus("authenticated");
            window.dispatchEvent(new Event("thesauros:navigating"));
            const destination = workspaceDestination("individual", {
              next,
              hash: location.hash,
              pathname: location.pathname,
            });
            // A hash-only navigation cannot refresh the server session.
            if (
              location.pathname ===
              new URL(destination, location.origin).pathname
            ) {
              history.replaceState(null, "", destination);
              location.reload();
            } else location.assign(destination);
            return true;
          } catch (e) {
            setError(e.message);
            return false;
          }
        },
        signOut: async () => {
          await post("sign-out", {});
          await disconnectAsync();
          setStatus("unauthenticated");
        },
      }),
    [next, disconnectAsync],
  );
  return (
    <RainbowKitAuthenticationProvider adapter={adapter} status={status}>
      <WalletTheme>
        <Connect busy={status === "authenticated"} />
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
      </WalletTheme>
    </RainbowKitAuthenticationProvider>
  );
}
export default function WalletAccess({ next = "" }) {
  return (
    <WalletProvider>
      <Access next={next} />
    </WalletProvider>
  );
}
