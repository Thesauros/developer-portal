"use client";
import { useEffect, useRef, useState } from "react";
import b from "./book/book.module.css";
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
    <section className={b.settingsSection}>
      <header className={b.sectionHead}>
        <div>
          <h2>Wallet account</h2>
          <p className={b.quiet}>You sign in and transact with this wallet.</p>
        </div>
      </header>
      <dl className={b.settingsFacts}>
        <div>
          <dt>Wallet address</dt>
          <dd className={b.breakAll}>{user.walletAddress}</dd>
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
      <div className={b.headActions}>
        <button className={b.secondary} onClick={copy}>
          Copy address
        </button>
        <button
          className={b.secondary}
          onClick={signOut}
          disabled={signingOut}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
      <p className={b.footnote} role="status">
        {message}
      </p>
    </section>
  );
}
