"use client";
import { useState } from "react";
import s from "./workspace.module.css";
export default function AccountSettings({ user }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    let field;
    try {
      if (navigator.clipboard && isSecureContext)
        await navigator.clipboard.writeText(user.walletAddress);
      else {
        field = document.createElement("textarea");
        field.value = user.walletAddress;
        document.body.append(field);
        field.select();
        if (!document.execCommand("copy")) throw new Error();
      }
      setCopied(true);
    } catch {
      setCopied(false);
    } finally {
      field?.remove();
    }
  }
  return (
    <div className={s.twoColumn}>
      <section className={s.panel}>
        <span className={s.eyebrow}>Your profile</span>
        <h2>Your wallet account</h2>
        <dl className={s.details}>
          <div>
            <dt>Wallet</dt>
            <dd style={{ overflowWrap: "anywhere" }}>{user.walletAddress}</dd>
          </div>
          <div>
            <dt>Account</dt>
            <dd>Individual</dd>
          </div>
          <div>
            <dt>Sign-in</dt>
            <dd>Wallet signature</dd>
          </div>
        </dl>
        <button className={s.secondaryButton} onClick={copy}>
          {copied ? "Address copied" : "Copy address"}
        </button>
      </section>
      <section className={s.panel}>
        <span className={s.eyebrow}>Account access</span>
        <h2>One wallet. Your workspace.</h2>
        <p>
          Reconnect this wallet to return to your account and saved test
          activity. A different wallet opens its own workspace.
        </p>
        <p className={s.caption}>
          Your wallet manages access. Thesauros never asks for your recovery
          phrase or private key.
        </p>
      </section>
    </div>
  );
}
