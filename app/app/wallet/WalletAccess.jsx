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
        authenticationStatus,
        mounted,
      }) => {
        // One modal connects and signs in, showing whichever step comes next.
        const action = !account
          ? openConnectModal
          : chain?.unsupported
            ? openChainModal
            : authenticationStatus !== "authenticated"
              ? openConnectModal
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
// The sign-in flow around any children. `stay` keeps the person on the page they
// are reading, so connecting from a vault page returns to that vault.
export function WalletAuth({ next, mode, stay = false, children, onError }) {
  const [status, setStatus] = useState("unauthenticated"),
    [error, setErrorState] = useState("");
  const setError = (value) => {
    setErrorState(value);
    onError?.(value);
  };
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
            // Signing in from the Institution page opens the Institution workspace.
            if (mode === "institution") {
              const joined = await fetch("/app/account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "join" }),
              });
              if (!joined.ok)
                throw new Error("Could not open the Institution workspace.");
            }
            setStatus("authenticated");
            window.dispatchEvent(new Event("thesauros:navigating"));
            if (stay) {
              location.reload();
              return true;
            }
            const destination = workspaceDestination(mode, {
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
    [next, mode, stay, disconnectAsync],
  );
  return (
    <RainbowKitAuthenticationProvider adapter={adapter} status={status}>
      <WalletTheme>
        {typeof children === "function"
          ? children({ status, error })
          : children}
      </WalletTheme>
    </RainbowKitAuthenticationProvider>
  );
}
function Access({ next, mode }) {
  return (
    <WalletAuth next={next} mode={mode}>
      {({ status, error }) => (
        <>
          <Connect busy={status === "authenticated"} />
          {error && (
            <p role="alert" className={s.error}>
              {error}
            </p>
          )}
        </>
      )}
    </WalletAuth>
  );
}
// The button that takes a guest from reading to signed in, one step at a time.
export function ConnectAction({ className, label = "Connect wallet" }) {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openConnectModal,
        openChainModal,
        authenticationStatus,
        mounted,
      }) => (
        <button
          className={className}
          disabled={!mounted || authenticationStatus === "loading"}
          onClick={
            !account || authenticationStatus !== "authenticated"
              ? chain?.unsupported
                ? openChainModal
                : openConnectModal
              : undefined
          }
        >
          {authenticationStatus === "authenticated"
            ? "Opening your account…"
            : !account
              ? label
              : chain?.unsupported
                ? "Switch network"
                : "Sign in with wallet"}
        </button>
      )}
    </ConnectButton.Custom>
  );
}
export default function WalletAccess({ next = "", mode = "individual" }) {
  return (
    <WalletProvider>
      <Access next={next} mode={mode} />
    </WalletProvider>
  );
}
