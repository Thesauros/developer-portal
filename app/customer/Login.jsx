"use client";
import { useState } from "react";
import { workspaceDestination } from "./destination.mjs";
import s from "./login.module.css";
const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

export default function Login({
  initialMode = "individual",
  initialStage = "login",
  next = "",
}) {
  const [mode, setMode] = useState(initialMode),
    [stage, setStage] = useState(initialStage),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [recovery, setRecovery] = useState(null),
    [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    password: "",
    key: "",
  });
  const set = (key, value) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const institution = mode === "institution";
  function changeStage(value) {
    setStage(value);
    setError("");
    setMessage("");
    setVisible(false);
  }
  function destination(user) {
    return workspaceDestination(user.accountType, {
      next,
      hash: location.hash,
      pathname: location.pathname,
    });
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const path =
        stage === "recover"
          ? "/customer/recover"
          : "/api/auth/" +
            (stage === "signup" ? "sign-up/email" : "sign-in/email");
      const body =
        stage === "recover"
          ? {
              email: form.email.trim(),
              key: form.key.trim(),
              password: form.password,
            }
          : stage === "signup"
            ? {
                name: form.name.trim(),
                company: form.company.trim(),
                email: form.email.trim(),
                password: form.password,
                accountType: mode,
              }
            : {
                email: form.email.trim(),
                password: form.password,
                rememberMe: true,
              };
      const response = await fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.message ||
            result.error ||
            "Please check your details and try again.",
        );
      if (stage === "recover") {
        setStage("login");
        setForm((previous) => ({ ...previous, password: "", key: "" }));
        setMessage("Password updated. Sign in with your new password.");
        return;
      }
      if (result.recoveryKey) {
        setRecovery({ key: result.recoveryKey, url: destination(result.user) });
        return;
      }
      window.dispatchEvent(new Event("thesauros:navigating"));
      window.location.assign(destination(result.user));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function copyRecovery() {
    try {
      if (navigator.clipboard && isSecureContext)
        await navigator.clipboard.writeText(recovery.key);
      else {
        const field = document.createElement("textarea");
        field.value = recovery.key;
        document.body.append(field);
        field.select();
        if (!document.execCommand("copy")) throw new Error();
        field.remove();
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  function downloadRecovery() {
    const url = URL.createObjectURL(
      new Blob(
        [
          "Thesauros account recovery\nEmail: " +
            form.email +
            "\nRecovery key: " +
            recovery.key +
            "\nKeep this key private. It can reset your password.\n",
        ],
        { type: "text/plain" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "thesauros-recovery-key.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className={s.page}>
      <section className={s.visual} aria-label="Thesauros">
        <img
          className={s.photo}
          src={
            base +
            "/brand/" +
            (institution ? "login-gallery.webp" : "login-reflections.webp")
          }
          alt=""
          fetchPriority="high"
        />
        <div className={s.shade} />
        <a className={s.brand} href="/">
          <img src={base + "/brand/mark.svg"} width="27" height="27" alt="" />
          Thesauros
        </a>
        <div className={s.visualCopy}>
          <span>Capital, with clarity.</span>
          <h2>
            {institution ? (
              <>
                A wider view.
                <br /> A stronger connection.
              </>
            ) : (
              <>
                Your next move.
                <br /> With a clearer view.
              </>
            )}
          </h2>
          <p>
            {institution
              ? "Your treasury, customers and infrastructure. One considered workspace."
              : "See where capital goes. Understand what it earns. Stay in control of your next move."}
          </p>
          <div className={s.visualFoot}>
            <span>
              Thesauros / {institution ? "Institution" : "Individual"}
            </span>
            <span>01 — Access</span>
          </div>
        </div>
      </section>
      <section className={s.access}>
        <div className={s.topLinks}>
          <a href="/docs/">Documentation</a>
          <a href="/contact">Contact</a>
        </div>
        <div className={s.formWrap}>
          <a className={s.mobileBrand} href="/">
            <img src={base + "/brand/mark.svg"} width="25" height="25" alt="" />
            Thesauros
          </a>
          {recovery ? (
            <>
              <span className={s.eyebrow}>Your account is ready</span>
              <h1>
                Keep your access.
                <br />
                Keep your key.
              </h1>
              <p className={s.intro}>
                Save this recovery key somewhere private. You can use it to
                reset your password.
              </p>
              <code className={s.recoveryKey}>{recovery.key}</code>
              <div className={s.recoveryActions}>
                <button onClick={copyRecovery}>
                  {copied ? "Copied" : "Copy key"}
                </button>
                <button onClick={downloadRecovery}>Download key</button>
              </div>
              <a className={s.primaryLink} href={recovery.url}>
                Continue to your account
              </a>
            </>
          ) : (
            <>
              <div className={s.modes} role="group" aria-label="Account type">
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={!institution}
                  onClick={() => {
                    setMode("individual");
                    setError("");
                  }}
                >
                  Individual
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={institution}
                  onClick={() => {
                    setMode("institution");
                    setError("");
                  }}
                >
                  Institution
                </button>
              </div>
              <span className={s.eyebrow}>
                {institution ? "Institution access" : "Your Thesauros account"}
              </span>
              <h1>
                {stage === "signup"
                  ? "A new account.\nA new possibility."
                  : stage === "recover"
                    ? "Find your way\nback in."
                    : "Welcome back."}
              </h1>
              <p className={s.intro}>
                {stage === "signup"
                  ? institution
                    ? "Bring your treasury, customer Earn and developer tools together."
                    : "Create your account to explore Earn and the markets underneath."
                  : stage === "recover"
                    ? "Enter your email and the recovery key you saved when creating your account."
                    : institution
                      ? "Sign in to your treasury, client reporting and developer workspace."
                      : "Your balance, your earnings and a clear view of the markets."}
              </p>
              <form className={s.form} onSubmit={submit}>
                {stage === "signup" && (
                  <>
                    <label htmlFor="auth-name">Full name</label>
                    <input
                      id="auth-name"
                      autoComplete="name"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      required
                      minLength={2}
                      maxLength={100}
                      disabled={busy}
                    />
                    {institution && (
                      <>
                        <label htmlFor="auth-company">Company</label>
                        <input
                          id="auth-company"
                          autoComplete="organization"
                          value={form.company}
                          onChange={(e) => set("company", e.target.value)}
                          required
                          minLength={2}
                          maxLength={120}
                          disabled={busy}
                        />
                      </>
                    )}
                  </>
                )}
                <label htmlFor="auth-email">
                  {institution ? "Work email" : "Email address"}
                </label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="username"
                  placeholder={
                    institution ? "you@company.com" : "you@example.com"
                  }
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  required
                  maxLength={254}
                  disabled={busy}
                />
                {stage === "recover" && (
                  <>
                    <label htmlFor="auth-key">Recovery key</label>
                    <input
                      id="auth-key"
                      autoComplete="off"
                      spellCheck="false"
                      value={form.key}
                      onChange={(e) => set("key", e.target.value)}
                      required
                      disabled={busy}
                    />
                  </>
                )}
                <div className={s.passwordLabel}>
                  <label htmlFor="auth-password">
                    {stage === "recover" ? "New password" : "Password"}
                  </label>
                  {stage === "login" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => changeStage("recover")}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className={s.password}>
                  <input
                    id="auth-password"
                    type={visible ? "text" : "password"}
                    autoComplete={
                      stage === "login" ? "current-password" : "new-password"
                    }
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                    required
                    minLength={stage === "login" ? 1 : 12}
                    maxLength={128}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    aria-label={visible ? "Hide password" : "Show password"}
                    aria-pressed={visible}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? "Hide" : "Show"}
                  </button>
                </div>
                {stage !== "login" && (
                  <span className={s.hint}>
                    At least 12 characters. Use a unique password for this
                    workspace.
                  </span>
                )}
                {error && (
                  <p className={s.error} role="alert">
                    {error}
                  </p>
                )}
                {message && (
                  <p className={s.message} role="status">
                    {message}
                  </p>
                )}
                <button className={s.submit} type="submit" disabled={busy}>
                  {busy
                    ? "One moment…"
                    : stage === "signup"
                      ? "Create account"
                      : stage === "recover"
                        ? "Reset password"
                        : "Sign in"}
                </button>
              </form>
              <div className={s.switch}>
                {stage === "login" ? (
                  <>
                    New to Thesauros?{" "}
                    <button
                      disabled={busy}
                      onClick={() => changeStage("signup")}
                    >
                      Create an account
                    </button>
                  </>
                ) : (
                  <>
                    Already have access?{" "}
                    <button
                      disabled={busy}
                      onClick={() => changeStage("login")}
                    >
                      Sign in
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <footer className={s.footer}>
          <span>© 2026 Thesauros</span>
          <a href="/docs/resources/terms/">Terms of use</a>
          <a href="/docs/security/controls/">Security</a>
        </footer>
      </section>
    </main>
  );
}
