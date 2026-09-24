export const units = (value, decimals = 6) =>
  value == null ? null : Number(value) / 10 ** decimals;

export function money(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  // Avoid showing a real but tiny amount as zero.
  const floor = 10 ** -digits;
  if (value !== 0 && Math.abs(value) < floor / 2)
    return (value < 0 ? "−" : "") + "<" + floor.toFixed(digits);
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// Small balances need more precision to show yield moving at all.
export function earned(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  return money(value, abs > 0 && abs < 1 ? 4 : 2);
}

export function signed(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  return (value >= 0 ? "+" : "−") + money(Math.abs(value), digits);
}

export function pct(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits) + "%";
}

export function points(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return (value >= 0 ? "+" : "−") + Math.abs(value).toFixed(2) + " pp";
}

export function ago(ms, now = Date.now()) {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 36) return h + (h === 1 ? " hour ago" : " hours ago");
  const d = Math.round(h / 24);
  return d + (d === 1 ? " day ago" : " days ago");
}

export function day(ms, withYear = false) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export function average(series) {
  const values = series.map((p) => p.v).filter((v) => v != null);
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

export const shortAddress = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
