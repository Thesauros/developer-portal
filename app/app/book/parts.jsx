"use client";
import { useEffect, useState } from "react";
import b from "./book.module.css";

export const money = (value, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : value !== 0 && Math.abs(value) < 10 ** -digits / 2
      ? "<" + (10 ** -digits).toFixed(digits)
      : value.toLocaleString("en-US", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });
// A vault with tens of thousands in it does not need cents in a column.
export const compact = (value) =>
  value == null ? "—" : money(value, Math.abs(value) >= 1000 ? 0 : 2);
export const pct = (value, digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits) + "%";
export const signed = (value, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : (value >= 0 ? "+" : "−") + money(Math.abs(value), digits);
export const dateLabel = (ms, withYear = true) =>
  ms == null || !Number.isFinite(ms)
    ? "—"
    : new Date(ms).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        ...(withYear ? { year: "numeric" } : {}),
      });
export const clock = (ms) =>
  new Date(ms).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
// A date range, without repeating the day when it starts and ends on the same one.
export const dayRange = (from, to) => {
  if (to == null) return `${dateLabel(from)} to now`;
  return dateLabel(from) === dateLabel(to)
    ? dateLabel(from)
    : `${dateLabel(from, false)} to ${dateLabel(to)}`;
};
export const hourOnly = (ms) =>
  new Date(ms).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
export function ago(seconds) {
  if (!Number.isFinite(seconds)) return "unknown";
  if (seconds < 90) return "just now";
  if (seconds < 5400) return Math.round(seconds / 60) + " min ago";
  if (seconds < 129600) return Math.round(seconds / 3600) + " hours ago";
  return Math.round(seconds / 86400) + " days ago";
}
export const short = (value) =>
  value ? value.slice(0, 6) + "…" + value.slice(-4) : "—";

// Always the same square, so a vault on two networks lines up with one on one.
export function Marks({ vault, size = 28 }) {
  const many = vault.marks.length > 1;
  const icon = many ? Math.round(size * 0.68) : size;
  return (
    <span
      className={b.marks}
      data-many={many || undefined}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {vault.marks.map((mark) => (
        <img
          key={mark.network}
          src={mark.icon}
          width={icon}
          height={icon}
          alt=""
        />
      ))}
    </span>
  );
}

const TOKEN_ICON = {
  USDC: "/brand/tokens/usdc.svg",
  USDT0: "/brand/tokens/usdt.svg",
  USDT: "/brand/tokens/usdt.svg",
};
// The stablecoin leads; networks are a detail of where a vault takes deposits.
export function TokenMark({ token, size = 28 }) {
  return (
    <img
      className={b.tokenMark}
      src={TOKEN_ICON[token] || TOKEN_ICON.USDC}
      width={size}
      height={size}
      alt=""
    />
  );
}
export function NetworkMarks({ vault, networks, size = 14 }) {
  const list = networks || vault?.marks?.map((mark) => mark.network) || [];
  const icons = vault?.marks
    ? Object.fromEntries(vault.marks.map((mark) => [mark.network, mark.icon]))
    : {};
  return (
    <span className={b.networkMarks} aria-hidden="true">
      {list.map((name) => (
        <img
          key={name}
          src={icons[name] || NETWORK_ICONS[name]}
          width={size}
          height={size}
          alt=""
          title={name}
        />
      ))}
    </span>
  );
}
const NETWORK_ICONS = {
  Ethereum: "/brand/tokens/eth.svg",
  Arbitrum: "/brand/tokens/arb.png",
  Base: "/brand/tokens/base.svg",
  Monad: "/brand/tokens/monad.png",
  Plasma: "/brand/tokens/plasma.png",
};
export const placeLabel = (vault) =>
  vault.kind === "batch"
    ? "Across " + vault.networks.join(", ")
    : "On " + vault.place;

export function VaultTitle({ vault, size = 28, place = true }) {
  return (
    <span className={b.vaultTitle}>
      <TokenMark token={vault.token} size={size} />
      <span>
        <strong>
          {vault.token} <span className={b.tag}>{vault.product.tag}</span>
        </strong>
        {place && (
          <small>
            <NetworkMarks vault={vault} size={12} />
            {placeLabel(vault)}
          </small>
        )}
      </span>
    </span>
  );
}
export function ProductTitle({ product, size = 28 }) {
  return (
    <span className={b.vaultTitle}>
      <TokenMark token={product.token} size={size} />
      <span>
        <strong className={b.titleLine}>
          {product.token} <span className={b.tag}>{product.tag}</span>
          <Stage stage={product.stage} />
        </strong>
        <small>{product.short || product.line}</small>
      </span>
    </span>
  );
}

// How far a rate is above or below the blue-chip index, in percentage points.
export function VsIndex({ diff, suffix = "" }) {
  if (diff == null || !Number.isFinite(diff))
    return <span className={b.quiet}>—</span>;
  const tone = Math.abs(diff) < 0.005 ? "even" : diff > 0 ? "ahead" : "behind";
  return (
    <span className={b.vsIndex} data-tone={tone}>
      {diff >= 0 ? "+" : "−"}
      {Math.abs(diff).toFixed(2)} pts{suffix}
    </span>
  );
}

const STAGE_NOTE = {
  Live: "Holds over 10,000 USD.",
  Early: "Holds under 10,000 USD, so its rates cannot yet be measured reliably.",
  Pilot: "Running with team funds. No external audit yet.",
};
export function Stage({ stage }) {
  if (!stage) return null;
  return (
    <span className={b.stage} data-stage={stage} title={STAGE_NOTE[stage]}>
      {stage}
    </span>
  );
}

export function Tier({ tier }) {
  if (!tier) return null;
  const label = { core: "Core", satellite: "Satellite" }[tier] || tier;
  return (
    <span className={b.tier} data-tier={tier}>
      {label}
    </span>
  );
}

export function Section({ id, title, lede, aside, children, className = "" }) {
  return (
    <section id={id} className={`${b.section} ${className}`}>
      <header className={b.sectionHead}>
        <div>
          <h2>{title}</h2>
          {lede && <p className={b.lede}>{lede}</p>}
        </div>
        {aside && <div className={b.sectionAside}>{aside}</div>}
      </header>
      {children}
    </section>
  );
}

export function Segmented({ label, options, value, onChange }) {
  return (
    <div className={b.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value ?? "all"}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// The 30-day figure, or the honest reason there isn't one.
export function measuredLabel(measure) {
  switch (measure?.status) {
    case "ok":
      return pct(measure.rate);
    case "small":
      return "Too small to measure";
    case "young":
      return "Too new to measure";
    default:
      return "—";
  }
}
export function MeasuredRate({ measure }) {
  const known = measure?.status === "ok";
  return (
    <span
      className={known ? undefined : b.quiet}
      title={
        measure?.status === "small"
          ? "This vault held under 10,000 USD in the period, so one cent would move this figure by whole points. The share price chart shows the raw change."
          : undefined
      }
    >
      {measuredLabel(measure)}
    </span>
  );
}

// Reads the public history once for every screen that needs it.
const histories = new Map();
export function usePublicResource(path, { refreshMs = 0, enabled = true } = {}) {
  const [state, setState] = useState(() => ({
    data: histories.get(path) ?? null,
    error: "",
    loading: !histories.has(path),
  }));
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    async function load() {
      try {
        const response = await fetch(path, {
          signal: AbortSignal.timeout(30000),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unavailable");
        histories.set(path, data);
        if (active) setState({ data, error: "", loading: false });
      } catch (error) {
        if (active)
          setState((last) => ({
            ...last,
            error: error.message || "Unavailable",
            loading: false,
          }));
      }
    }
    load();
    const timer = refreshMs
      ? setInterval(() => {
          if (!document.hidden) load();
        }, refreshMs)
      : null;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [path, refreshMs, enabled]);
  return state;
}
