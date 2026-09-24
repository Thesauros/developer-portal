"use client";
import { useEffect, useState } from "react";
import c from "./cabinet.module.css";

async function send(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.message || data.error || "Something went wrong.");
  return data;
}

function useAction() {
  const [state, setState] = useState({ busy: false, error: "", done: "" });
  async function run(action, done) {
    setState({ busy: true, error: "", done: "" });
    try {
      await action();
      setState({ busy: false, error: "", done });
      return true;
    } catch (e) {
      setState({ busy: false, error: e.message, done: "" });
      return false;
    }
  }
  return [state, run];
}

function Status({ state }) {
  if (state.error)
    return (
      <p className={c.formError} role="alert">
        {state.error}
      </p>
    );
  if (state.done)
    return (
      <p className={c.formDone} role="status">
        {state.done}
      </p>
    );
  return null;
}

export default function InstitutionSettings({ user, signOut, signingOut }) {
  const [wallet, runWallet] = useAction();
  const [password, runPassword] = useAction();
  const [sessions, runSessions] = useAction();
  const [address, setAddress] = useState("");
  const [count, setCount] = useState(null);

  function loadSessions() {
    fetch("/api/auth/list-sessions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((rows) => Array.isArray(rows) && setCount(rows.length))
      .catch(() => {});
  }
  useEffect(loadSessions, []);

  return (
    <div className={c.page}>
      <section className={c.section}>
        <header className={c.sectionHead}>
          <div>
            <h2>Profile</h2>
            <p className={c.muted}>Your Institution account.</p>
          </div>
        </header>
        <dl className={c.factsGrid}>
          <div>
            <dt>Name</dt>
            <dd>{user.name}</dd>
          </div>
          <div>
            <dt>Company</dt>
            <dd>{user.company || "—"}</dd>
          </div>
          <div>
            <dt>Work email</dt>
            <dd className={c.breakAll}>{user.email}</dd>
          </div>
          <div>
            <dt>Sign-in method</dt>
            <dd>Email and password</dd>
          </div>
        </dl>
      </section>

      <section className={c.section} id="treasury">
        <header className={c.sectionHead}>
          <div>
            <h2>Treasury wallet</h2>
            <p className={c.muted}>
              The address your workspace tracks: balances, earnings and
              activity. Linking is read-only; deposits and withdrawals are still
              signed in that wallet.
            </p>
          </div>
        </header>
        {user.walletAddress ? (
          <div className={c.walletRow}>
            <div>
              <strong className={c.breakAll}>{user.walletAddress}</strong>
              <small className={c.muted}>
                Linked. Portfolio and Activity show this address.
              </small>
            </div>
            <button
              className={c.secondary}
              disabled={wallet.busy}
              onClick={() =>
                runWallet(
                  () => send("/app/account", { address: null }),
                  "Wallet removed.",
                ).then((ok) => ok && location.reload())
              }
            >
              Remove
            </button>
          </div>
        ) : (
          <form
            className={c.inlineForm}
            onSubmit={(e) => {
              e.preventDefault();
              runWallet(
                () => send("/app/account", { address }),
                "Wallet linked.",
              ).then((ok) => ok && location.reload());
            }}
          >
            <label className={c.formField}>
              <span>Wallet address</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
                required
              />
            </label>
            <button className={c.primary} disabled={wallet.busy}>
              {wallet.busy ? "Linking…" : "Link wallet"}
            </button>
          </form>
        )}
        <Status state={wallet} />
      </section>

      <div className={c.split}>
        <section className={c.section}>
          <header className={c.sectionHead}>
            <div>
              <h2>Change password</h2>
              <p className={c.muted}>
                Other devices are signed out after the change.
              </p>
            </div>
          </header>
          <form
            className={c.stackForm}
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = Object.fromEntries(new FormData(form));
              runPassword(async () => {
                if (f.next !== f.confirm)
                  throw new Error("The new passwords do not match.");
                await send("/api/auth/change-password", {
                  currentPassword: f.current,
                  newPassword: f.next,
                  revokeOtherSessions: true,
                });
                form.reset();
                loadSessions();
              }, "Password changed. Other sessions were signed out.");
            }}
          >
            <label className={c.formField}>
              <span>Current password</span>
              <input
                name="current"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <label className={c.formField}>
              <span>New password</span>
              <input
                name="next"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
              <small>At least 12 characters.</small>
            </label>
            <label className={c.formField}>
              <span>Repeat new password</span>
              <input
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
            </label>
            <Status state={password} />
            <div>
              <button className={c.primary} disabled={password.busy}>
                {password.busy ? "Updating…" : "Update password"}
              </button>
            </div>
          </form>
        </section>

        <section className={c.section}>
          <header className={c.sectionHead}>
            <div>
              <h2>Sessions</h2>
              <p className={c.muted}>
                {count == null
                  ? "Devices signed in to this account."
                  : count === 1
                    ? "Only this device is signed in."
                    : `${count} devices are signed in, including this one.`}
              </p>
            </div>
          </header>
          <div className={c.actions}>
            <button
              className={c.secondary}
              disabled={sessions.busy || count === 1}
              onClick={() =>
                runSessions(async () => {
                  await send("/api/auth/revoke-other-sessions", {});
                  loadSessions();
                }, "Other devices were signed out.")
              }
            >
              Sign out other devices
            </button>
            <button
              className={c.secondary}
              onClick={signOut}
              disabled={signingOut}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
          <Status state={sessions} />
          <p className={c.footnote}>
            Forgot your password? Reset it from the sign-in page with the
            recovery key you saved when the account was created. Lost the key?
            Contact b2b@thesauros.io from your work email.
          </p>
        </section>
      </div>
    </div>
  );
}
