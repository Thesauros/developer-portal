"use client";
import { Amount, VaultMark } from "./parts";
import { money, pct, points } from "./format";
import c from "./cabinet.module.css";

// Page column plus the account rail: actions and balances stay in reach on
// every money screen.
export function RailLayout({ rail, children }) {
  return (
    <div className={c.withRail}>
      <div className={c.page}>{children}</div>
      <aside className={c.rail} aria-label="Your account">
        {rail}
      </aside>
    </div>
  );
}

export default function Rail({ rows, onEarn, navigate, needsWallet = false }) {
  const depositable = rows.filter((r) => r.depositable);
  const held = rows.filter((r) => r.balance > 0);
  const inEarn = held.reduce((s, r) => s + r.balance, 0);
  const cash = rows.reduce((s, r) => s + (r.cash || 0), 0);
  const rate = inEarn
    ? held.reduce((s, r) => s + r.balance * (r.rate || 0), 0) / inEarn
    : null;
  const spread = inEarn
    ? held.reduce((s, r) => s + r.balance * (r.marketSpread30d || 0), 0) /
      inEarn
    : null;
  const earnedTotal = rows.reduce((s, r) => s + (r.earned || 0), 0);
  const best = [...depositable].sort(
    (a, b) => (b.apr30d || 0) - (a.apr30d || 0),
  )[0];
  const main =
    [...held].sort((a, b) => b.balance - a.balance)[0] || best || rows[0];
  const share = inEarn + cash > 0 ? (inEarn / (inEarn + cash)) * 100 : 0;

  return (
    <>
      <div className={c.railActions}>
        {needsWallet ? (
          <button className={c.pill} onClick={() => navigate("settings")}>
            Link wallet
          </button>
        ) : (
          <>
            <button
              className={c.pill}
              onClick={() => onEarn(main?.id || "arbitrum", "deposit")}
            >
              Deposit <span aria-hidden="true">+</span>
            </button>
            <button
              className={c.pill}
              disabled={!held.length}
              onClick={() => onEarn(main?.id, "withdraw")}
            >
              Withdraw <span aria-hidden="true">↗</span>
            </button>
          </>
        )}
      </div>

      <div className={c.railCard}>
        <div className={c.railSplit}>
          <div>
            <span>In wallet</span>
            <strong>
              <Amount value={cash} />
            </strong>
          </div>
          <div className={c.alignEnd}>
            <span>In Earn</span>
            <strong className={c.positive}>
              <Amount value={inEarn} />
            </strong>
          </div>
        </div>
        <div className={c.railBar} aria-hidden="true">
          <span style={{ width: share + "%" }} />
        </div>
        <span className={c.railLabel}>By network</span>
        <ul className={c.railList}>
          {depositable.map((r) => (
            <li key={r.id}>
              <VaultMark vault={r} size={30} />
              <span>
                <strong>{r.network}</strong>
                <small>{r.cash ? money(r.cash) + " in wallet" : "USDC"}</small>
              </span>
              <span className={c.railAmount}>
                <Amount value={r.balance ?? 0} />
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className={c.railTiles}>
        <div>
          <span>{inEarn ? "Earning now" : "Best 30-day rate"}</span>
          <strong>{pct(inEarn ? rate : best?.apr30d)}</strong>
          {!inEarn && best && <small>{best.network} vault</small>}
        </div>
        <div>
          <span>{inEarn ? "Per month" : "vs market"}</span>
          <strong>
            {inEarn
              ? money((inEarn * (rate || 0)) / 100 / 12)
              : points(best?.marketSpread30d)}
          </strong>
          {inEarn ? <small>USDC at this rate</small> : <small>30 days</small>}
        </div>
        {inEarn > 0 && (
          <>
            <div>
              <span>Earned</span>
              <strong className={c.positive}>{money(earnedTotal)}</strong>
              <small>USDC all time</small>
            </div>
            <div>
              <span>vs market</span>
              <strong className={spread >= 0 ? c.positive : c.negative}>
                {points(spread)}
              </strong>
              <small>30-day average</small>
            </div>
          </>
        )}
      </div>
    </>
  );
}
