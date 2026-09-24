"use client";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../ui/primitives";
import platform from "../platform.module.css";
import { fmt, pct, stamp, downloadCsv } from "./LivePanels";
import s from "./workspace.module.css";
import q from "./sandbox.module.css";
import { csvContent } from "../../lib/workspace-view.mjs";
import BrandLoading from "../ui/BrandLoading";
const requestId = () =>
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
export default function TestAccount({ mode }) {
  const fetching = useRef(null),
    writing = useRef(false);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState(null),
    [amount, setAmount] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    async function refresh() {
      if (writing.current) return;
      fetching.current?.abort();
      const controller = new AbortController();
      fetching.current = controller;
      try {
        const r = await fetch("/app/api?mode=" + mode, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!r.ok) throw new Error();
        const value = await r.json();
        if (active && !controller.signal.aborted) {
          setData(value);
          setError("");
        }
      } catch (e) {
        if (active && e.name !== "AbortError")
          setError(
            "Sandbox could not refresh. Your last received balance is shown if available.",
          );
      }
    }
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 30000);
    return () => {
      active = false;
      fetching.current?.abort();
      clearInterval(timer);
    };
  }, [mode, revision]);
  async function send(body) {
    if (writing.current) return;
    writing.current = true;
    fetching.current?.abort();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/app/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, mode }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || "Please retry.");
      setData(result);
      setOperation(null);
      setNotice(
        body.type === "fund"
          ? "10,000 simulated USDC added."
          : body.type === "deposit"
            ? "Deposit completed in Sandbox."
            : "Withdrawal completed in Sandbox.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  function open(type) {
    setOperation({ type, requestId: requestId() });
    setAmount("");
    setError("");
  }
  function exportCsv() {
    downloadCsv(
      csvContent([
        ["Thesauros Sandbox", "Simulated transactions — no onchain funds"],
        ["Type", "Amount USDC", "Timestamp UTC", "Reference"],
        ...data.account.events.map((e) => [e.type, e.amount, e.at, e.id]),
      ]),
      "thesauros-sandbox-transactions.csv",
    );
  }
  const account = data?.account;
  const available =
    operation?.type === "deposit" ? account?.cash : account?.earnBalance;
  const hasWithdrawn = account?.events.some(
    (event) => event.type === "withdraw",
  );
  const hasDeposited =
    hasWithdrawn ||
    account?.principal > 0 ||
    account?.events.some((event) => event.type === "deposit");
  const steps = [
    {
      title: "Add test funds",
      description: "Start with 10,000 simulated USDC.",
      complete: !!data?.funded,
    },
    {
      title: "Make a deposit",
      description: "Move an amount into your Earn balance.",
      complete: !!hasDeposited,
    },
    {
      title: "Try a withdrawal",
      description: "Bring funds back to your available balance.",
      complete: !!hasWithdrawn,
    },
  ];
  const nextStep = steps.findIndex((step) => !step.complete);
  const guidance = !data?.funded
    ? [
        "Start with a test balance.",
        "Add 10,000 simulated USDC, then choose how much to put into Earn.",
      ]
    : !hasDeposited
      ? [
          "Your test funds are ready.",
          "Choose Deposit to move some of your available USDC into Earn.",
        ]
      : !hasWithdrawn
        ? [
            "Now try taking funds out.",
            "Withdraw any amount from Earn and see it return to your available balance.",
          ]
        : [
            "You’ve completed the Earn journey.",
            "Keep exploring deposits and withdrawals. Your balances and activity stay in this account.",
          ];
  return (
    <BrandLoading pending={!data && !error} label="Loading Sandbox">
      <div className={platform.shell + " " + s.testWrapper}>
        <div className={q.introduction}>
          <div>
            <span className={q.simulation}>Simulated USDC</span>
            <h2>Experience the Earn account.</h2>
            <p>
              Add a balance, put it to work, then withdraw. Explore the full
              flow without moving funds from your wallet.
            </p>
          </div>
          {account && (
            <span className={q.progress}>
              {steps.filter((step) => step.complete).length} of 3 steps explored
            </span>
          )}
        </div>
        {error && !operation && (
          <p className={s.warning} role="alert">
            {error}{" "}
            <button
              className={s.textButton}
              onClick={() => setRevision((v) => v + 1)}
            >
              Retry
            </button>
          </p>
        )}
        {notice && (
          <p className={s.success} role="status">
            {notice}
          </p>
        )}
        {account && (
          <>
            <ol className={q.steps} aria-label="Your Sandbox journey">
              {steps.map((step, index) => (
                <li
                  key={step.title}
                  data-complete={step.complete}
                  aria-current={index === nextStep ? "step" : undefined}
                >
                  <span className={q.stepNumber} aria-hidden="true">
                    {step.complete ? (
                      <svg viewBox="0 0 20 20" fill="none">
                        <path
                          d="m5 10 3.3 3.3L15 6.7"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      String(index + 1).padStart(2, "0")
                    )}
                  </span>
                  <div>
                    <strong>
                      {step.title}
                      {step.complete && (
                        <span className={q.visuallyHidden}> · Completed</span>
                      )}
                    </strong>
                    <span>{step.description}</span>
                  </div>
                </li>
              ))}
            </ol>
            <section className={q.account} aria-label="Simulated Earn account">
              <div className={q.balanceGrid}>
                <div className={q.earnBalance}>
                  <div className={q.balanceHeading}>
                    <img
                      src="/brand/tokens/usdc.svg"
                      alt=""
                      width="28"
                      height="28"
                    />
                    <h2>Earn account</h2>
                  </div>
                  <span>Earn balance · USDC</span>
                  <strong data-testid="earn-balance">
                    {fmt(account.earnBalance)}
                  </strong>
                  <span className={q.rate}>
                    {pct(data.netApy * 100)} fixed model APY
                  </span>
                </div>
                <div className={q.secondaryBalances}>
                  <div>
                    <span>Available · USDC</span>
                    <strong data-testid="available-balance">
                      {fmt(account.cash)}
                    </strong>
                    <p>Ready for your next deposit.</p>
                  </div>
                  <div>
                    <span>Accrued yield · USDC</span>
                    <strong>{fmt(account.earned)}</strong>
                    <p>Calculated over time at the fixed model rate.</p>
                  </div>
                </div>
              </div>
              <div className={q.nextAction}>
                <div>
                  <h3>{guidance[0]}</h3>
                  <p>{guidance[1]}</p>
                </div>
                <div className={q.actions}>
                  {!data.funded && (
                    <button
                      className={s.primaryButton}
                      disabled={busy}
                      onClick={() => send({ type: "fund" })}
                    >
                      {busy ? "Adding funds…" : "Add 10,000 USDC"}
                    </button>
                  )}
                  <button
                    className={
                      data.funded && (!hasDeposited || hasWithdrawn)
                        ? s.primaryButton
                        : s.secondaryButton
                    }
                    onClick={() => open("deposit")}
                    disabled={!account.cash || busy}
                  >
                    Deposit
                  </button>
                  <button
                    className={
                      hasDeposited && !hasWithdrawn
                        ? s.primaryButton
                        : s.secondaryButton
                    }
                    onClick={() => open("withdraw")}
                    disabled={!account.earnBalance || busy}
                  >
                    Withdraw
                  </button>
                </div>
              </div>
              <div className={q.accountFoot}>
                <span>
                  Balances and yield are simulated. No funds move onchain.
                </span>
                <span>Updated {stamp(data.updatedAt)}</span>
              </div>
            </section>
            <section className={s.panel}>
              <div className={s.panelHead}>
                <div>
                  <h2>Transactions</h2>
                  <p className={q.transactionIntro}>
                    Your simulated deposits and withdrawals, in one place.
                  </p>
                </div>
                <button
                  className={s.secondaryButton}
                  onClick={exportCsv}
                  disabled={!account.events.length}
                >
                  Export CSV
                </button>
              </div>
              {account.events.length ? (
                <div
                  className={s.tableWrap}
                  tabIndex={0}
                  role="region"
                  aria-label="Simulated transactions"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th className={s.numeric}>Amount · USDC</th>
                        <th>Time · UTC</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {account.events.map((e) => (
                        <tr key={e.id}>
                          <td>
                            {e.type === "fund"
                              ? "Starting balance"
                              : e.type === "deposit"
                                ? "Deposit"
                                : "Withdrawal"}
                          </td>
                          <td className={s.numeric}>{fmt(e.amount)}</td>
                          <td>{stamp(e.at).replace(" UTC", "")}</td>
                          <td>Completed</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={q.empty}>
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="5" y="3" width="14" height="18" rx="3" />
                    <path d="M9 8h6M9 12h6M9 16h3" />
                  </svg>
                  <strong>Your first transaction starts here.</strong>
                  <p>
                    Add the test balance above. Every deposit and withdrawal
                    will appear here.
                  </p>
                </div>
              )}
            </section>
          </>
        )}
        <Modal
          open={!!operation}
          onClose={() => {
            if (!busy) setOperation(null);
          }}
          title={
            operation?.type === "deposit"
              ? "Deposit to Earn"
              : "Withdraw from Earn"
          }
        >
          {account && (
            <form
              className={s.form}
              onSubmit={(e) => {
                e.preventDefault();
                send({
                  ...operation,
                  accountId: account.id,
                  amount: Number(amount),
                });
              }}
            >
              <p className={s.caption}>Sandbox · simulated USDC</p>
              <label htmlFor="test-amount">Amount · USDC</label>
              <div className={s.amountInput}>
                <input
                  id="test-amount"
                  aria-label="Amount USDC"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  max={available}
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setOperation((v) => ({ ...v, requestId: requestId() }));
                  }}
                  required
                  disabled={busy}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAmount(String(Math.floor(available * 100 + 1e-7) / 100));
                    setOperation((v) => ({ ...v, requestId: requestId() }));
                  }}
                >
                  Max
                </button>
              </div>
              <p className={s.caption}>Available: {fmt(available)} USDC</p>
              <dl className={s.details}>
                <div>
                  <dt>Model APY</dt>
                  <dd>{pct(data.netApy * 100)} · fixed</dd>
                </div>
              </dl>
              {error && (
                <p className={s.warning} role="alert">
                  {error}
                </p>
              )}
              <button className={s.primaryButton} disabled={busy}>
                {busy
                  ? "Updating…"
                  : operation?.type === "deposit"
                    ? "Confirm deposit"
                    : "Confirm withdrawal"}
              </button>
            </form>
          )}
        </Modal>
      </div>
    </BrandLoading>
  );
}
