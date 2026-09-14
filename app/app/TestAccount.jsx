"use client";
import { useEffect, useState } from "react";
import { Modal } from "../ui/primitives";
import platform from "../platform.module.css";
import { fmt, pct, Mark, stamp } from "./LivePanels";
import s from "./workspace.module.css";
import BrandLoading from "../ui/BrandLoading";
const requestId = () =>
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
export default function TestAccount({ mode }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState(null),
    [amount, setAmount] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const r = await fetch("/app/api?mode=" + mode, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!r.ok) throw new Error();
        setData(await r.json());
      } catch (e) {
        if (e.name !== "AbortError")
          setError("The test account could not load.");
      }
    }
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [mode]);
  async function send(body) {
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
          ? "10,000 test USDC added to your account."
          : body.type === "deposit"
            ? "Test deposit completed."
            : "Test withdrawal completed.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function open(type) {
    setOperation({ type, requestId: requestId() });
    setAmount("");
    setError("");
  }
  function exportCsv() {
    const rows = [
      ["Thesauros test account", "Simulated transactions"],
      ["Type", "Amount USDC", "Timestamp UTC", "Reference"],
      ...data.account.events.map((e) => [e.type, e.amount, e.at, e.id]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        [
          rows
            .map((r) =>
              r
                .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
                .join(","),
            )
            .join("\n"),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "thesauros-test-transactions.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const account = data?.account;
  return (
    <BrandLoading pending={!data && !error} label="Opening your test account">
      <div className={platform.shell + " " + s.testWrapper}>
        {error && !operation && (
          <p className={s.warning} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className={s.success} role="status">
            {notice}
          </p>
        )}
        {!data ? null : (
          <>
            <div className={s.twoColumn}>
              <section className={s.testBalance}>
                <div className={s.panelHead}>
                  <span>
                    {mode === "institution"
                      ? "Treasury test account"
                      : "Your test Earn account"}
                  </span>
                  <span className={s.pill}>Test USDC</span>
                </div>
                <div className={s.walletValue}>
                  <span>Earn balance</span>
                  <strong data-testid="earn-balance">
                    {fmt(account.earnBalance)}
                  </strong>
                </div>
                <div className={s.testBalanceMeta}>
                  <span>{pct(data.netApy * 100)} fixed test APY</span>
                  <span>Earned {fmt(account.earned)} USDC</span>
                </div>
                <div className={s.buttonRow}>
                  <button
                    onClick={() => open("deposit")}
                    disabled={!account.cash || busy}
                  >
                    Test deposit
                  </button>
                  <button
                    onClick={() => open("withdraw")}
                    disabled={!account.earnBalance || busy}
                  >
                    Test withdrawal
                  </button>
                </div>
                <div className={s.testCash}>
                  <span>Available test balance</span>
                  <strong data-testid="available-balance">
                    {fmt(account.cash)} USDC
                  </strong>
                </div>
                {!data.funded && (
                  <button
                    className={s.fundButton}
                    disabled={busy}
                    onClick={() => send({ type: "fund" })}
                  >
                    {busy ? "Adding funds…" : "Get 10,000 test USDC"}
                  </button>
                )}
              </section>
              <section className={s.panel}>
                <span className={s.eyebrow}>Explore the experience</span>
                <h2>
                  From a balance
                  <br />
                  to an Earn account.
                </h2>
                <p>
                  Try a deposit, follow simulated yield and withdraw to your
                  test balance. Your test activity stays with this account.
                </p>
                <div className={s.testSteps}>
                  <div>
                    <span>01</span>
                    <p>Add test funds</p>
                  </div>
                  <div>
                    <span>02</span>
                    <p>Make a test deposit</p>
                  </div>
                  <div>
                    <span>03</span>
                    <p>Withdraw when you choose</p>
                  </div>
                </div>
                <p className={s.caption}>
                  Test transactions use a fixed model rate and do not move funds
                  onchain.
                </p>
              </section>
            </div>
            <section className={s.panel}>
              <div className={s.panelHead}>
                <div>
                  <span className={s.eyebrow}>Test allocation</span>
                  <h2>The flow underneath.</h2>
                </div>
                <span className={s.pill}>Simulation</span>
              </div>
              <div className={s.testAllocation}>
                {data.strategy.map((p) => (
                  <div key={p.provider}>
                    <Mark name={p.provider.toLowerCase()} />
                    <strong>{p.provider}</strong>
                    <span>{pct(p.weight * 100)} allocation</span>
                    <small>{pct(p.apy * 100)} fixed gross APY</small>
                  </div>
                ))}
              </div>
            </section>
            <section className={s.panel}>
              <div className={s.panelHead}>
                <h2>Test account activity</h2>
                <button className={s.textButton} onClick={exportCsv}>
                  Export CSV
                </button>
              </div>
              <div
                className={s.tableWrap}
                tabIndex="0"
                role="region"
                aria-label="Test transactions"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Amount · test USDC</th>
                      <th>Time (UTC)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.events.map((e) => (
                      <tr key={e.id}>
                        <td>
                          {e.type === "fund"
                            ? "Test funds added"
                            : e.type === "deposit"
                              ? "Test deposit"
                              : "Test withdrawal"}
                        </td>
                        <td>{fmt(e.amount)}</td>
                        <td>{stamp(e.at).replace(" UTC", "")}</td>
                        <td>Completed</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!account.events.length && (
                  <div className={s.empty}>
                    Your first test transaction will appear here.
                  </div>
                )}
              </div>
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
              ? "Make a test deposit"
              : "Make a test withdrawal"
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
              <span className={s.caption}>
                Test USDC ·{" "}
                {operation?.type === "deposit"
                  ? "Add to Earn"
                  : "Return to your test balance"}
              </span>
              <label htmlFor="test-amount">Amount</label>
              <div className={s.amountInput}>
                <input
                  id="test-amount"
                  aria-label="Amount USDC"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  max={
                    operation?.type === "deposit"
                      ? account.cash
                      : account.earnBalance
                  }
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
                    setAmount(
                      String(
                        operation?.type === "deposit"
                          ? account.cash
                          : account.earnBalance,
                      ),
                    );
                    setOperation((v) => ({ ...v, requestId: requestId() }));
                  }}
                >
                  Max
                </button>
              </div>
              <p className={s.caption}>
                Available:{" "}
                {fmt(
                  operation?.type === "deposit"
                    ? account.cash
                    : account.earnBalance,
                )}{" "}
                USDC
              </p>
              <dl className={s.details}>
                <div>
                  <dt>Fixed test APY</dt>
                  <dd>{pct(data?.netApy * 100)}</dd>
                </div>
                <div>
                  <dt>Network transaction</dt>
                  <dd>Simulated</dd>
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
                    ? "Confirm test deposit"
                    : "Confirm test withdrawal"}
              </button>
            </form>
          )}
        </Modal>
      </div>
    </BrandLoading>
  );
}
