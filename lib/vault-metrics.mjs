// The numbers every vault is measured by, with one definition for all of them.
// Pure functions: unit-tested, no I/O. A figure that cannot be stated honestly
// comes back with a status instead of a number.
export const DAY = 86400000;
// Below this a one-cent donation moves an annualised figure by whole points.
export const MIN_MEASURED_TVL = 10000;
const WINDOW_TOLERANCE = 0.1;
const MIN_HISTORY_DAYS = 7;
const SAMPLE_SPACING = 1.1 * DAY;
const finite = (value) => typeof value === "number" && Number.isFinite(value);

function clean(points) {
  return (points || [])
    .filter((point) => finite(point?.at) && finite(point?.price) && point.price > 0)
    .sort((a, b) => a.at - b.at);
}

// What holders received over a window, from the share price, as a simple
// annual rate: (P1 / P0 - 1) * 365 / days. Statuses:
//   ok     the figure can be shown
//   small  the vault held under MIN_MEASURED_TVL at some point in the window
//   young  under a week of history
//   gap    no sample close enough to the start of the window
//   none   not enough data
export function measuredRate(
  points,
  days,
  { now = Date.now(), maxAgeMs = 36 * 3600000, minTvl = MIN_MEASURED_TVL } = {},
) {
  const series = clean(points);
  if (series.length < 2) return { status: "none" };
  const last = series.at(-1);
  const window = days * DAY;
  const target = last.at - window;
  // Readings can be a day apart, so a short window gets at least that much room.
  const allowed = Math.max(window * WINDOW_TOLERANCE, SAMPLE_SPACING);
  let sinceLaunch = false;
  let start;
  if (series[0].at > target + allowed) {
    const age = (last.at - series[0].at) / DAY;
    if (age < MIN_HISTORY_DAYS) return { status: "young", days: age };
    start = series[0];
    sinceLaunch = true;
  } else {
    start = series
      .slice(0, -1)
      .reduce((best, point) =>
        Math.abs(point.at - target) < Math.abs(best.at - target) ? point : best,
      );
    if (Math.abs(start.at - target) > allowed) return { status: "gap" };
  }
  const span = (last.at - start.at) / DAY;
  const tvls = series
    .filter((point) => point.at >= start.at && finite(point.tvl))
    .map((point) => point.tvl);
  const lowest = tvls.length ? Math.min(...tvls) : null;
  const change = last.price / start.price - 1;
  return {
    status: lowest != null && lowest >= minTvl ? "ok" : "small",
    rate: (change * 365 * 100) / span,
    change: change * 100,
    days: span,
    from: start,
    to: last,
    sinceLaunch,
    stale: now - last.at > maxAgeMs,
    lowestTvl: lowest,
  };
}

// The rate since the vault last held enough to be measured, for a vault that has
// grown past the threshold: its early dust days say nothing about the strategy.
export function sinceMeasurable(
  points,
  { minTvl = MIN_MEASURED_TVL, now = Date.now() } = {},
) {
  const series = clean(points);
  let first = 0;
  series.forEach((point, index) => {
    if (!(point.tvl >= minTvl)) first = index + 1;
  });
  const from = series[first],
    to = series.at(-1);
  if (!from || !to || from === to) return null;
  const days = (to.at - from.at) / DAY;
  if (days < MIN_HISTORY_DAYS) return null;
  return {
    rate: ((to.price / from.price - 1) * 365 * 100) / days,
    days,
    from: from.at,
    stale: now - to.at > 36 * 3600000,
  };
}

// The same simple rate for an Aave reserve index between two moments, using the
// samples nearest to them. Null unless both ends are within a day and a half.
export function indexRate(points, fromAt, toAt) {
  const series = (points || []).filter(
    (point) => finite(point?.at) && finite(point?.index) && point.index > 0,
  );
  if (series.length < 2 || !(toAt > fromAt)) return null;
  const nearest = (at) =>
    series.reduce((best, point) =>
      Math.abs(point.at - at) < Math.abs(best.at - at) ? point : best,
    );
  const a = nearest(fromAt),
    b = nearest(toAt);
  const slack = 1.5 * DAY;
  if (
    !(b.at > a.at) ||
    Math.abs(a.at - fromAt) > slack ||
    Math.abs(b.at - toAt) > slack
  )
    return null;
  return ((b.index / a.index - 1) * 365 * 100) / ((b.at - a.at) / DAY);
}

// Periods when the valuation was older than the vault allows. `staleShare` is
// the share of the vault's life spent that way; `gaps` are the long ones, dated.
export function valuationGaps(
  ticks,
  { maxAgeMs = 7200000, minGapMs = 6 * 3600000, now = Date.now() } = {},
) {
  const times = (ticks || [])
    .map((tick) => tick.at)
    .filter(finite)
    .sort((a, b) => a - b);
  if (times.length < 2) return { gaps: [], staleShare: null, since: times[0] ?? null };
  let stale = 0;
  const gaps = [];
  const stops = [...times, now];
  for (let index = 1; index < stops.length; index++) {
    const gap = stops[index] - stops[index - 1];
    if (gap > maxAgeMs) stale += gap - maxAgeMs;
    if (gap >= minGapMs)
      gaps.push({
        from: stops[index - 1],
        to: index === stops.length - 1 ? null : stops[index],
        hours: gap / 3600000,
      });
  }
  return { gaps, staleShare: (stale / (now - times[0])) * 100, since: times[0] };
}

// A dated price series with enough points to draw, from the valuation ticks of
// the batch vault or the daily samples of the others.
export function pricePoints(points, days, now = Date.now()) {
  const series = clean(points);
  return days ? series.filter((point) => point.at >= now - days * DAY) : series;
}

// USDC amount to shares for a batch withdrawal. Rounds up so the person gets at
// least what they typed at this price, never more shares than they hold, and
// sweeps a remainder too small to be worth leaving behind.
export function sharesForAmount(amountUnits, rateBid, heldShares) {
  const amount = BigInt(amountUnits),
    rate = BigInt(rateBid),
    held = BigInt(heldShares);
  if (amount <= 0n || rate <= 0n || held <= 0n) return 0n;
  const scale = 10n ** 18n;
  const shares = (amount * scale + rate - 1n) / rate;
  if (shares >= held) return held;
  const left = ((held - shares) * rate) / scale;
  return left < 10000n ? held : shares;
}
