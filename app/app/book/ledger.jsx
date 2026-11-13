"use client";
import { clock, dateLabel, dayRange, money, pct } from "./parts";
import b from "./book.module.css";

const GLYPH = {
  deposit: ["↓", "in"],
  withdraw: ["↑", "out"],
  request: ["→", "neutral"],
  earned: ["+", "earn"],
  rebalance: ["⇄", "move"],
  transfer: ["⇄", "move"],
  batch: ["≡", "move"],
  gap: ["!", "warn"],
  collect: ["✓", "in"],
  cancel: ["×", "neutral"],
};

function describe(row, vaultName) {
  const vault = vaultName ? vaultName(row.vaultId) : null;
  const where = vault ? vault + ". " : "";
  switch (row.kind) {
    case "rebalance":
      return {
        title: `${row.fromName} to ${row.toName}`,
        detail: `${where}${row.moves > 1 ? row.moves + " moves between markets" : "Moved between markets"}, ${clock(row.at)}${
          row.moves === 1 && row.rateFrom != null && row.rateTo != null
            ? `. Rates on the block before the move: ${pct(row.rateFrom)} where it left, ${pct(row.rateTo)} where it went${
                row.rateAfter != null && Math.abs(row.rateAfter - row.rateTo) >= 0.01
                  ? `, ${pct(row.rateAfter)} there once the money arrived`
                  : ""
              }`
            : ""
        }`,
      };
    case "transfer":
      return {
        title: `${row.fromName} to ${row.toName}`,
        detail: `${where}Sent ${clock(row.at)}${row.arrivedAt ? `, arrived ${clock(row.arrivedAt)}` : ", on its way"}`,
      };
    case "batch":
      return {
        title: row.settled ? "Batch settled" : "Batch in progress",
        detail: `${where}${row.requests} ${row.requests === 1 ? "request" : "requests"}, ${clock(row.at)}`,
      };
    case "gap":
      return {
        title: "No valuation published",
        detail: `${where}${dayRange(row.at, row.until)}, ${Math.round(row.hours)} hours. Settlement waited.`,
      };
    default:
      return {
        title: row.title,
        detail: `${where}${row.at ? clock(row.at) : ""}${row.stands != null ? `. ${money(row.amount)} shares` : ""}${row.note ? ". " + row.note : ""}`,
      };
  }
}

function amountOf(row) {
  if (row.kind === "gap") return null;
  if (row.kind === "batch") {
    const parts = [];
    if (row.deposits) parts.push(`${money(row.deposits)} USDC in`);
    if (row.redeems) parts.push(`${money(row.redeems)} shares out`);
    return parts.join(", ") || null;
  }
  if (row.amount == null) return null;
  // A share amount reads as the USDC it stands for; the shares go in the detail.
  if (row.stands != null)
    return `${row.about ? "about " : ""}${money(row.stands)} USDC`;
  const sign =
    row.kind === "deposit" || row.kind === "earned"
      ? "+"
      : row.kind === "withdraw"
        ? "−"
        : "";
  const digits = row.kind === "earned" && row.amount < 1 ? 4 : 2;
  return `${sign}${money(row.amount, digits)} ${row.unit || row.token || ""}`.trim();
}

// Moves made in one transaction are one event: three rows for one rebalance would
// read as three decisions.
export function groupEvents(rows) {
  const out = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (
      row.kind === "rebalance" &&
      last?.kind === "rebalance" &&
      last.vaultId === row.vaultId &&
      last.url === row.url
    ) {
      const froms = new Set([...last.froms, row.fromName]);
      const tos = new Set([...last.tos, row.toName]);
      last.froms = froms;
      last.tos = tos;
      last.fromName = [...froms].join(", ");
      last.toName = [...tos].join(", ");
      last.amount += row.amount || 0;
      last.moves += 1;
    } else if (row.kind === "rebalance")
      out.push({
        ...row,
        moves: 1,
        froms: new Set([row.fromName]),
        tos: new Set([row.toName]),
      });
    else out.push(row);
  }
  return out;
}

function Row({ row, vaultName, hideVault }) {
  const [glyph, tone] = GLYPH[row.kind] || GLYPH.batch;
  const { title, detail } = describe(row, hideVault ? null : vaultName);
  const amount = amountOf(row);
  return (
    <li data-small={row.kind === "rebalance" && row.amount < 1 ? "" : undefined}>
      <span className={b.glyph} data-tone={tone} aria-hidden="true">
        {glyph}
      </span>
      <span className={b.ledgerMain}>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <span className={b.ledgerAmount} data-tone={tone}>
        {amount}
      </span>
      {row.url ? (
        <a href={row.url} target="_blank" rel="noreferrer">
          Transaction ↗
        </a>
      ) : (
        <span />
      )}
    </li>
  );
}

// `limit` counts events, after the moves of one transaction are joined: cutting
// the rows first could split a transaction and show only part of it.
export function LedgerRows({ rows, vaultName, hideVault = false, byDay = false, limit = Infinity }) {
  const grouped = groupEvents(rows).slice(0, limit);
  if (!byDay)
    return (
      <ul className={b.ledger}>
        {grouped.map((row) => (
          <Row
            key={row.id}
            row={row}
            vaultName={vaultName}
            hideVault={hideVault}
          />
        ))}
      </ul>
    );
  const days = [];
  for (const row of grouped) {
    const label = dateLabel(row.at);
    if (days.at(-1)?.label !== label) days.push({ label, rows: [] });
    days.at(-1).rows.push(row);
  }
  return days.map((day) => (
    <section key={day.label} className={b.ledgerDay}>
      <h3>{day.label}</h3>
      <ul className={b.ledger}>
        {day.rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            vaultName={vaultName}
            hideVault={hideVault}
          />
        ))}
      </ul>
    </section>
  ));
}
