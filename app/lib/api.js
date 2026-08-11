// Client-side helper for talking to the Thesauros API.
// Defaults to the built-in sandbox on the same origin (/api/v1);
// set NEXT_PUBLIC_API_BASE to point the portal at a real API deployment.

export const BASE = process.env.NEXT_PUBLIC_API_BASE || '/api/v1';

// Real-data mode: the portal reads live data from the Thesauros Partner API,
// proxied same-origin through Next.js rewrites (/api/v1/real/* -> PARTNER_API_URL).
// Enable with NEXT_PUBLIC_DATA_SOURCE=real (see .env.example).
export const DATA_SOURCE = process.env.NEXT_PUBLIC_DATA_SOURCE === 'real' ? 'real' : 'sandbox';
export const IS_REAL = DATA_SOURCE === 'real';
export const REAL_BASE = '/api/v1/real';
// On-chain protocol metrics, proxied to the monitoring service.
export const MONITOR_BASE = '/api/v1/monitor';

export const BOOTSTRAP_KEY = 'tsk_test_thesauros_sandbox_0000000000000000';
// Real-mode defaults (test environment seeded keys):
// - session key: partner-scoped so partner views (Users, Analytics) work;
// - admin key: keys:admin for the API Keys management surface, which the
//   partner-scoped session key cannot call.
export const REAL_BOOTSTRAP_KEY = 'tsk_test_acme_partner_key_00000000000000000';
export const REAL_ADMIN_KEY = 'tsk_test_master_full_access_000000000000000';
export const DEFAULT_KEY = IS_REAL ? REAL_BOOTSTRAP_KEY : BOOTSTRAP_KEY;

export class PortalApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

/**
 * Perform a request against the portal API.
 * Returns the unwrapped `data` payload; attaches `meta` + headers info
 * on the returned object's non-enumerable props for the few callers that
 * need envelopes. Most callers just want `data`.
 *
 * `base` selects the API surface: BASE (built-in sandbox, default) or
 * REAL_BASE (same-origin proxy to the real Partner API).
 */
export async function api(path, { method = 'GET', key = BOOTSTRAP_KEY, body, base = BASE } = {}) {
  const headers = { Accept: 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }

  if (!res.ok) {
    const err = json && json.error ? json.error : {};
    throw new PortalApiError(res.status, err.code, err.message);
  }

  const data = json && Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json;
  const meta = json && json.meta ? json.meta : undefined;
  return { data, meta, status: res.status, headers: res.headers };
}

export const get = (path, opts) => api(path, { ...opts, method: 'GET' });
export const post = (path, body, opts) => api(path, { ...opts, method: 'POST', body });
export const del = (path, opts) => api(path, { ...opts, method: 'DELETE' });

// The monitoring backend sleeps when idle; the first request after a cold
// start can outlive the edge proxy timeout. Retry with backoff so the second
// attempt lands on the warmed instance.
export async function getRetry(path, opts, { retries = 2, delayMs = 2000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await get(path, opts);
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

/* ---------- monitoring service mapping ---------- */

const PROVIDER_KEYS = ['aave', 'morpho', 'compound', 'dolomite', 'treasury'];

// Map the monitoring service dashboard payload (on-chain data) to the
// sandbox vault shape the portal views render. Monitoring APYs are percent
// strings ("9.2057" == 9.2057%); the portal uses decimal fractions.
export function mapMonitorVaults(dash) {
  if (!dash || !Array.isArray(dash.vaults)) return [];
  const chain = dash.networkInfo ? dash.networkInfo.networkName : '';
  const series =
    dash.apyAnalytics && Array.isArray(dash.apyAnalytics.series) ? dash.apyAnalytics.series : [];
  const totalTvl = dash.vaults.reduce((a, v) => a + (Number(v.tvl) || 0), 0);
  return dash.vaults.map((v) => {
    const providerLabel = v.providerInfo && v.providerInfo.name ? v.providerInfo.name : '';
    const lower = providerLabel.toLowerCase();
    const apyPct = v.providerInfo && v.providerInfo.apy != null ? Number(v.providerInfo.apy) : null;
    const s = series.find((x) => x.vaultAddress === v.address);
    const tvlUsd = Number(v.tvl) || 0;
    return {
      id: v.address,
      name: v.name,
      provider: PROVIDER_KEYS.find((k) => lower.includes(k)) || 'morpho',
      providerName: providerLabel || null,
      chain,
      asset: v.token || v.symbol,
      apy: apyPct != null && Number.isFinite(apyPct) ? apyPct / 100 : null,
      apy_7d_avg: null,
      tvl_usd: tvlUsd,
      allocation_pct: totalTvl > 0 ? tvlUsd / totalTvl : 0,
      risk_tier: 'on-chain',
      status: v.status || 'active',
    };
  });
}

// Map monitoring apyData to the portal yield-snapshot row shape.
export function mapMonitorYield(dash) {
  if (!dash || !Array.isArray(dash.apyData)) return [];
  const series =
    dash.apyAnalytics && Array.isArray(dash.apyAnalytics.series) ? dash.apyAnalytics.series : [];
  return dash.apyData.map((a) => {
    const apyPct = Number(a.apy);
    const s = series.find((x) => x.vaultAddress === a.vaultAddress);
    return {
      asset: a.token,
      best_apy: Number.isFinite(apyPct) ? apyPct / 100 : null,
      blend_apy: Number.isFinite(apyPct) ? apyPct / 100 : null,
      blended_30d: s && s.netYieldAfterFees != null ? s.netYieldAfterFees / 100 : null,
    };
  });
}

/* ---------- formatting ---------- */

export function fmtUsd(n, { compact = false, digits = 2 } = {}) {
  if (!Number.isFinite(n)) return '—';
  if (compact) {
    const abs = Math.abs(n);
    const suf = abs >= 1e9 ? ['B', 1e9] : abs >= 1e6 ? ['M', 1e6] : abs >= 1e3 ? ['K', 1e3] : ['', 1];
    const v = n / suf[1];
    return `$${v.toFixed(v >= 100 || suf[0] === '' ? 0 : 1)}${suf[0]}`;
  }
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtNum(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}

export function fmtPct(n, digits = 2) {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

// The API represents APY as a decimal fraction (0.052 === 5.2%).
export function fmtApy(dec, digits = 2) {
  if (!Number.isFinite(dec)) return '—';
  return `${(dec * 100).toFixed(digits)}%`;
}

export function fmtMs(n) {
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n)}ms`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function maskKey(secret) {
  if (!secret) return '—';
  // Match the API's masking format exactly (tsk_test_...a1b2).
  const prefix = secret.startsWith('tsk_live_') ? 'tsk_live_' : 'tsk_test_';
  return `${prefix}...${secret.slice(-4)}`;
}

export function shortAddr(addr) {
  if (!addr || addr.length < 12) return addr || '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function shortHash(h) {
  if (!h || h.length < 14) return h || '—';
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}
