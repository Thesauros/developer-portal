"use client";
import { useState } from "react";
import { base } from "./LivePanels";
import s from "./workspace.module.css";
export default function AccountSettings({ user, mode }) {
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch(base + "/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: current,
          newPassword: password,
          revokeOtherSessions: true,
        }),
      });
      const result = await r.json();
      if (!r.ok)
        throw new Error(result.message || "The password could not be changed.");
      setCurrent("");
      setPassword("");
      setMessage("Password changed. Other sessions have been signed out.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={s.twoColumn}>
      <section className={s.panel}>
        <span className={s.eyebrow}>Your profile</span>
        <h2>Account details</h2>
        <dl className={s.details}>
          {[
            ["Name", user.name],
            ["Email", user.email],
            ["Account", mode === "institution" ? "Institution" : "Individual"],
            ...(mode === "institution" ? [["Company", user.company]] : []),
          ].map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className={s.caption}>
          Keep the recovery key from registration in a private place. It lets
          you restore access if you forget your password.
        </p>
      </section>
      <section className={s.panel}>
        <span className={s.eyebrow}>Account access</span>
        <h2>Change your password</h2>
        <form className={s.form} onSubmit={submit}>
          <label htmlFor="current-password">Current password</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
            maxLength={128}
          />
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={12}
            maxLength={128}
            required
          />
          <small>At least 12 characters.</small>
          {error && (
            <p className={s.warning} role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className={s.success} role="status">
              {message}
            </p>
          )}
          <button className={s.primaryButton} disabled={busy}>
            {busy ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>
    </div>
  );
}
