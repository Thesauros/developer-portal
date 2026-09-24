"use client";
import { useState } from "react";
import AccessShell from "./AccessShell";
import s from "./login.module.css";

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.message || data.error || "Something went wrong. Try again.",
    );
  return data;
}

function Field({ label, hint, ...props }) {
  return (
    <label className={s.field}>
      <span>{label}</span>
      <input {...props} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

export default function InstitutionLogin() {
  const [view, setView] = useState("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [saved, setSaved] = useState(false);

  function go(next) {
    setView(next);
    setError("");
    setNotice("");
  }
  async function run(event, action) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await action(Object.fromEntries(new FormData(event.currentTarget)));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const enter = () => location.assign("/app/institution");

  if (recoveryKey)
    return (
      <AccessShell institution>
        <h1>Save your recovery key</h1>
        <p className={s.intro}>
          This key is the only way to reset your password. We show it once and
          store only a hash of it.
        </p>
        <div className={s.recoveryKey}>
          <code>{recoveryKey}</code>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(recoveryKey)}
          >
            Copy
          </button>
        </div>
        <label className={s.check}>
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
          />
          I have saved the key somewhere private
        </label>
        <button
          className={s.walletConnectButton}
          disabled={!saved}
          onClick={enter}
        >
          Open the workspace
        </button>
      </AccessShell>
    );

  return (
    <AccessShell institution>
      {view === "signin" && (
        <>
          <h1>Sign in to your workspace</h1>
          <p className={s.intro}>
            Track your treasury in Earn, compare vaults and manage your
            integration.
          </p>
          <form
            className={s.form}
            onSubmit={(e) =>
              run(e, async (f) => {
                await post("/api/auth/sign-in/email", {
                  email: f.email.trim().toLowerCase(),
                  password: f.password,
                });
                enter();
              })
            }
          >
            <Field
              label="Work email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
            />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
            {notice && (
              <p className={s.success} role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            <button className={s.walletConnectButton} disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <div className={s.switchLinks}>
            <button type="button" onClick={() => go("signup")}>
              Create an account
            </button>
            <button type="button" onClick={() => go("recover")}>
              Forgot password?
            </button>
          </div>
        </>
      )}

      {view === "signup" && (
        <>
          <h1>Create an Institution account</h1>
          <p className={s.intro}>
            One account for your team’s view of Earn, the vaults and the Partner
            API.
          </p>
          <form
            className={s.form}
            onSubmit={(e) =>
              run(e, async (f) => {
                if (f.password !== f.confirm)
                  throw new Error("The passwords do not match.");
                const result = await post("/api/auth/sign-up/email", {
                  name: f.name,
                  company: f.company,
                  email: f.email.trim().toLowerCase(),
                  password: f.password,
                });
                setRecoveryKey(result.recoveryKey);
              })
            }
          >
            <Field
              label="Your name"
              name="name"
              autoComplete="name"
              required
              minLength={2}
              maxLength={100}
            />
            <Field
              label="Company"
              name="company"
              autoComplete="organization"
              required
              minLength={2}
              maxLength={120}
            />
            <Field
              label="Work email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
            />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              hint="At least 12 characters."
            />
            <Field
              label="Repeat password"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            <button className={s.walletConnectButton} disabled={busy}>
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>
          <div className={s.switchLinks}>
            <button type="button" onClick={() => go("signin")}>
              I already have an account
            </button>
          </div>
        </>
      )}

      {view === "recover" && (
        <>
          <h1>Reset your password</h1>
          <p className={s.intro}>
            Use the recovery key you saved when you created the account. All
            signed-in sessions will be closed.
          </p>
          <form
            className={s.form}
            onSubmit={(e) =>
              run(e, async (f) => {
                await post("/app/recover", {
                  email: f.email,
                  key: f.key,
                  password: f.password,
                });
                go("signin");
                setNotice("Password updated. Sign in with the new password.");
              })
            }
          >
            <Field
              label="Work email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
            />
            <Field
              label="Recovery key"
              name="key"
              autoComplete="off"
              spellCheck={false}
              required
              maxLength={100}
            />
            <Field
              label="New password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              hint="At least 12 characters."
            />
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            <button className={s.walletConnectButton} disabled={busy}>
              {busy ? "Updating…" : "Set new password"}
            </button>
          </form>
          <div className={s.switchLinks}>
            <button type="button" onClick={() => go("signin")}>
              Back to sign in
            </button>
          </div>
        </>
      )}
    </AccessShell>
  );
}
