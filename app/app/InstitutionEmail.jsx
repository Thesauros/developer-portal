"use client";
import { useState } from "react";
import AccessShell from "./AccessShell";
import s from "./login.module.css";

async function account(body) {
  const response = await fetch("/app/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// Work email (and optionally a password for email sign-in) for an Institution
// account created with a wallet. Used after sign-in, where it can be skipped,
// and in Account settings.
export function EmailForm({
  company = "",
  onDone,
  submitLabel = "Save email",
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [saved, setSaved] = useState(false);
  if (recoveryKey)
    return (
      <div className={s.form}>
        <p className={s.intro}>
          You can now also sign in with your email. Save this recovery key: it
          is the only way to reset the password.
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
          onClick={onDone}
        >
          Continue
        </button>
      </div>
    );
  return (
    <form
      className={s.form}
      onSubmit={async (event) => {
        event.preventDefault();
        const f = Object.fromEntries(new FormData(event.currentTarget));
        setBusy(true);
        setError("");
        try {
          if (f.password && f.password !== f.confirm)
            throw new Error("The passwords do not match.");
          const result = await account({
            action: "email",
            email: f.email,
            company: f.company,
            password: f.password || "",
          });
          if (result.recoveryKey) setRecoveryKey(result.recoveryKey);
          else onDone();
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className={s.field}>
        <span>Work email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      <label className={s.field}>
        <span>Company</span>
        <input
          name="company"
          autoComplete="organization"
          defaultValue={company}
          maxLength={120}
        />
      </label>
      <label className={s.field}>
        <span>Password (optional)</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
        />
        <small>
          Set one to also sign in with your email. At least 12 characters.
        </small>
      </label>
      <label className={s.field}>
        <span>Repeat password</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          maxLength={128}
        />
      </label>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <button className={s.walletConnectButton} disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

export default function InstitutionEmail({ company }) {
  const [skipping, setSkipping] = useState(false);
  const enter = () => location.replace("/app/institution");
  return (
    <AccessShell institution>
      <h1>Add your work email</h1>
      <p className={s.intro}>
        We use it for account notices and, if you set a password, as a second
        way to sign in. You can also add it later in Account.
      </p>
      <EmailForm
        company={company}
        onDone={enter}
        submitLabel="Save and continue"
      />
      <div className={s.switchLinks}>
        <button
          type="button"
          disabled={skipping}
          onClick={async () => {
            setSkipping(true);
            await account({ action: "skip-email" }).catch(() => {});
            enter();
          }}
        >
          {skipping ? "Opening…" : "Skip for now"}
        </button>
      </div>
    </AccessShell>
  );
}
