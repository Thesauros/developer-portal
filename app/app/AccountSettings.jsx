"use client";
import { useEffect, useRef, useState } from "react";
import s from "./workspace.module.css";
export default function AccountSettings({ user, signOut, signingOut }) {
  const [message, setMessage] = useState("");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    let field;
    try {
      if (navigator.clipboard && isSecureContext)
        await navigator.clipboard.writeText(user.walletAddress);
      else {
        field = document.createElement("textarea");
        field.value = user.walletAddress;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        field.select();
        if (!document.execCommand("copy")) throw new Error();
      }
      setMessage("Address copied.");
    } catch {
      setMessage(
        "Could not copy. Select the address above to copy it manually.",
      );
    } finally {
      field?.remove();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(""), 5000);
    }
  }
  return (
    <section className={s.panel}>
      <h2>Wallet account</h2>
      <dl className={s.details}>
        <div>
          <dt>Wallet address</dt>
          <dd className={s.fullAddress}>{user.walletAddress}</dd>
        </div>
        <div>
          <dt>Account type</dt>
          <dd>Individual</dd>
        </div>
        <div>
          <dt>Sign-in method</dt>
          <dd>Wallet signature</dd>
        </div>
      </dl>
      <div className={s.buttonRow}>
        <button className={s.secondaryButton} onClick={copy}>
          Copy address
        </button>
        <button
          className={s.secondaryButton}
          onClick={signOut}
          disabled={signingOut}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
      <p className={s.caption} role="status">
        {message}
      </p>
    </section>
  );
}
