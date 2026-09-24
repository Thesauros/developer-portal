"use client";

import { useEffect, useRef, useState } from "react";
import s from "./funding.module.css";

export default function WalletFunding({
  vault,
  owner,
  onClose,
  onRefresh,
  onSandbox,
  returnFocusRef,
  loading = false,
}) {
  const dialog = useRef(null);
  const title = useRef(null);
  const opener = useRef(null);
  const restoreFocus = useRef(true);
  const mounted = useRef(false);
  const checkingRef = useRef(false);
  const [checking, setChecking] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [error, setError] = useState("");
  const recipientValid =
    /^0x[\da-f]{40}$/i.test(owner || "") &&
    owner.toLowerCase() !== vault.address.toLowerCase() &&
    owner.toLowerCase() !== vault.asset.toLowerCase();

  useEffect(() => {
    mounted.current = true;
    restoreFocus.current = true;
    const element = dialog.current;
    const candidate = returnFocusRef?.current || document.activeElement;
    if (candidate !== document.body && !element.contains(candidate))
      opener.current = candidate;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!element.open) element.showModal();
    const focusFrame = requestAnimationFrame(() => title.current?.focus());
    return () => {
      mounted.current = false;
      cancelAnimationFrame(focusFrame);
      if (element.open) element.close();
      document.body.style.overflow = previousOverflow;
      if (restoreFocus.current) {
        requestAnimationFrame(() => {
          if (element.open || mounted.current) return;
          const target = opener.current?.isConnected
            ? opener.current
            : document.querySelector("#account-main h1");
          target?.focus({ preventScroll: true });
        });
      }
    };
  }, []);

  function dismiss() {
    dialog.current?.close();
    onClose();
  }

  function visitSandbox() {
    restoreFocus.current = false;
    dismiss();
    requestAnimationFrame(() => onSandbox());
  }

  async function copyAddress(event) {
    if (!recipientValid) return;
    const button = event.currentTarget;
    setCopyStatus("");
    let copied = false;
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(owner);
        copied = true;
      } catch {
        // HTTP previews and denied clipboard permissions use a selected field.
      }
    }
    if (!copied && mounted.current) {
      const field = document.createElement("textarea");
      field.value = owner;
      field.readOnly = true;
      field.tabIndex = -1;
      field.setAttribute("aria-label", "Wallet address to copy");
      field.style.cssText = "position:fixed;left:-10000px;top:0;opacity:0;";
      // It must stay inside the native dialog; the rest of the document is inert.
      dialog.current.appendChild(field);
      try {
        field.focus();
        field.select();
        field.setSelectionRange(0, owner.length);
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      } finally {
        field.remove();
        if (button.isConnected) button.focus({ preventScroll: true });
      }
    }
    if (mounted.current)
      setCopyStatus(
        copied
          ? "Wallet address copied."
          : "Could not copy automatically. Select and copy the wallet address above.",
      );
  }

  async function checkBalance() {
    if (checkingRef.current || loading) return;
    checkingRef.current = true;
    setChecking(true);
    setError("");
    try {
      const result = await onRefresh();
      if (result === false)
        throw new Error("The balance could not be checked. Try again shortly.");
      if (mounted.current) dismiss();
    } catch (failure) {
      if (mounted.current)
        setError(
          failure?.message ||
            "The balance could not be checked. Try again shortly.",
        );
    } finally {
      checkingRef.current = false;
      if (mounted.current) setChecking(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-labelledby="wallet-funding-title"
      aria-describedby="wallet-funding-intro"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target !== dialog.current) return;
        const box = dialog.current.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...dialog.current.querySelectorAll(
            "button:not([disabled]), a[href], input:not([disabled]), [tabindex='0']",
          ),
        ].filter((node) => node.getClientRects().length);
        const first = controls[0],
          last = controls.at(-1);
        const active = document.activeElement;
        if (!controls.length) {
          event.preventDefault();
          title.current?.focus();
        } else if (
          event.shiftKey &&
          (active === first || !controls.includes(active))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (active === last || !controls.includes(active))
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div className={s.frame}>
        <header className={s.header}>
          <div className={s.network}>
            <img src={vault.icon} width="25" height="25" alt="" />
            <span>{vault.name}</span>
          </div>
          <button
            className={s.close}
            onClick={dismiss}
            aria-label="Close wallet funding"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className={s.content}>
          <h2 ref={title} tabIndex={-1} id="wallet-funding-title">
            Add {vault.symbol} to your wallet
          </h2>
          <p id="wallet-funding-intro" className={s.intro}>
            Send native {vault.symbol} on {vault.name} to your signed-in wallet.
            Then return to Earn to make a deposit.
          </p>

          <section
            className={s.recipient}
            aria-labelledby="funding-recipient-label"
          >
            <span id="funding-recipient-label" className={s.label}>
              Your wallet address
            </span>
            {recipientValid ? (
              <>
                <code className={s.address}>{owner}</code>
                <button className={s.copy} onClick={copyAddress}>
                  Copy wallet address
                </button>
              </>
            ) : (
              <p className={s.error} role="alert">
                Your signed-in wallet address is unavailable. Close this panel
                and reconnect your wallet.
              </p>
            )}
            <p className={s.copyStatus} role="status" aria-live="polite">
              {copyStatus}
            </p>
          </section>

          <dl className={s.details}>
            <div>
              <dt>Asset and network</dt>
              <dd>
                Native {vault.symbol} on {vault.name}
                <a
                  href={vault.explorer + "/address/" + vault.asset}
                  target="_blank"
                  rel="noreferrer"
                >
                  View {vault.symbol} token contract
                </a>
              </dd>
            </div>
            <div>
              <dt>Network fees</dt>
              <dd>
                Keep some ETH on {vault.name} for approval and deposit fees.
              </dd>
            </div>
            <div>
              <dt>Once it arrives</dt>
              <dd>
                Check your wallet balance, then choose how much to deposit into
                Earn.
              </dd>
            </div>
          </dl>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className={s.footer}>
          <button
            className={s.primary}
            onClick={checkBalance}
            disabled={checking || loading || !recipientValid}
          >
            {checking || loading
              ? "Checking wallet balance…"
              : "Check wallet balance"}
          </button>
          <button className={s.secondary} onClick={visitSandbox}>
            Try Sandbox
          </button>
        </footer>
      </div>
    </dialog>
  );
}
