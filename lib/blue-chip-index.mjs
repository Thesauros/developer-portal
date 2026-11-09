// The blue-chip index, worked out from daily readings of each market. Pure
// functions only: the indexer stores the readings (lib/market-index.mjs) and
// the server and tests compute from them here.
//
// Membership: every lending market a Thesauros vault is approved to use, as the
// vault contracts list them on that day. Weight: how much the market holds.
// Return: each market's own interest index between two daily readings, so the
// index earns what its markets paid, not what they quoted.
import { DAY } from "./vault-metrics.mjs";

export const INDEX_NAME = "Blue-chip index";
// A market counts once it holds this much: below it, a market is too small to
// say much about where the money is, and approving a tiny one cannot move the
// index.
export const MIN_MEMBER_SIZE = 1_000_000;
// A market that moves more than this in a day is a broken read, not interest.
const MAX_DAILY_MOVE = 0.01;

const weightedTime = (rows) => {
  let weight = 0,
    sum = 0;
  for (const row of rows.values()) {
    weight += row.tvl;
    sum += row.tvl * row.at;
  }
  return Math.round(sum / weight);
};

/**
 * rows: [{ key, network, source, day, at, kind, symbol, name, protocol,
 *          idx, tvl, rate }] with idx and tvl as numbers, rate in % a year.
 */
// Members per stablecoin, from approved markets of at least the minimum size.
export function membersOf(rows, symbol, minSize = MIN_MEMBER_SIZE) {
  return (rows || []).filter(
    (row) => row.symbol === symbol && row.tvl >= minSize,
  );
}

// When a market joined or left the index, from the days it was a member.
export function membershipChanges(rows) {
  const spans = new Map();
  let first = Infinity,
    last = -Infinity;
  for (const row of rows || []) {
    first = Math.min(first, row.day);
    last = Math.max(last, row.day);
    const span = spans.get(row.key) || { row, from: row.day, to: row.day };
    span.from = Math.min(span.from, row.day);
    span.to = Math.max(span.to, row.day);
    spans.set(row.key, span);
  }
  const changes = [];
  for (const { row, from, to } of spans.values()) {
    const base = { key: row.key, name: row.name, network: row.network, protocol: row.protocol };
    if (from > first) changes.push({ ...base, day: from, at: from * DAY, kind: "joined" });
    if (to < last) changes.push({ ...base, day: to + 1, at: (to + 1) * DAY, kind: "left" });
  }
  return changes.sort((a, c) => c.day - a.day);
}

export function buildBlueChipIndex(rows, { now = Date.now() } = {}) {
  // A market missing a day between two readings gets that day filled in on the
  // curve between them, so every step of the index covers the same interval for
  // every market. A gap longer than a week is left open.
  const byKey = new Map();
  for (const row of rows || []) {
    if (!(row.tvl > 0) || !(row.idx > 0)) continue;
    if (!byKey.has(row.key)) byKey.set(row.key, new Map());
    byKey.get(row.key).set(row.day, row);
  }
  const days = new Map();
  const put = (row) => {
    if (!days.has(row.day)) days.set(row.day, new Map());
    days.get(row.day).set(row.key, row);
  };
  for (const readings of byKey.values()) {
    const list = [...readings.values()].sort((a, c) => a.day - c.day);
    list.forEach((row, i) => {
      put(row);
      const next = list[i + 1];
      if (!next || next.day - row.day <= 1 || next.day - row.day > 7) return;
      for (let day = row.day + 1; day < next.day; day++) {
        const part = (day - row.day) / (next.day - row.day);
        put({
          ...row,
          day,
          at: row.at + (next.at - row.at) * part,
          idx: row.idx * (next.idx / row.idx) ** part,
          rate: null,
          filled: true,
        });
      }
    });
  }
  const order = [...days.keys()].sort((a, b) => a - b);
  if (!order.length) return null;
  const series = [];
  const rates = [];
  const skipped = [];
  let level = 1;
  for (let i = 0; i < order.length; i++) {
    const today = days.get(order[i]);
    // The moment a point stands for is where the money is: weighted by size.
    const at = weightedTime(today);
    if (i > 0) {
      const before = days.get(order[i - 1]);
      const span = Math.max(order[i] - order[i - 1], 1);
      let weight = 0,
        sum = 0;
      for (const [key, start] of before) {
        const end = today.get(key);
        if (!end) continue;
        const move = end.idx / start.idx - 1;
        if (!Number.isFinite(move) || Math.abs(move) > MAX_DAILY_MOVE * span) {
          skipped.push({ key, day: order[i] });
          continue;
        }
        weight += start.tvl;
        sum += start.tvl * move;
      }
      if (weight > 0) level *= 1 + sum / weight;
    }
    series.push({ at, level });
    let quoted = 0,
      quotedWeight = 0;
    for (const row of today.values())
      if (row.rate != null && Number.isFinite(row.rate)) {
        quoted += row.tvl * row.rate;
        quotedWeight += row.tvl;
      }
    if (quotedWeight > 0) rates.push({ at, rate: quoted / quotedWeight });
  }
  const latest = new Map(
    [...days.get(order.at(-1))].filter(([, row]) => !row.filled),
  );
  const total = [...latest.values()].reduce((s, row) => s + row.tvl, 0);
  const constituents = [...latest.values()]
    .map((row) => ({
      key: row.key,
      network: row.network,
      source: row.source,
      name: row.name,
      protocol: row.protocol,
      symbol: row.symbol,
      tvl: row.tvl,
      weight: (row.tvl / total) * 100,
      rate: row.rate ?? null,
      vaults: row.vaults || [],
    }))
    .sort((a, b) => b.tvl - a.tvl);
  const unread = constituents.filter((row) => row.rate == null);
  const read = constituents.filter((row) => row.rate != null);
  const readWeight = read.reduce((s, row) => s + row.tvl, 0);
  // What the index earned over the previous week at each reading, a year: the
  // history shows earnings, not quotes, so no quote can move it.
  const earned = earnedSeries(series, 7);
  return {
    name: INDEX_NAME,
    series,
    rates,
    earned,
    rateNow: readWeight
      ? read.reduce((s, row) => s + row.tvl * row.rate, 0) / readWeight
      : null,
    total,
    constituents,
    unread: unread.map((row) => row.key),
    networks: [...new Set(constituents.map((row) => row.network))],
    from: series[0].at,
    to: series.at(-1).at,
    stale: now - series.at(-1).at > 2 * DAY,
    skipped: skipped.length,
  };
}

const nearest = (series, at, tolerance) => {
  let best = null;
  for (const point of series) {
    const gap = Math.abs(point.at - at);
    if (gap <= tolerance && (!best || gap < Math.abs(best.at - at))) best = point;
  }
  return best;
};

/** Simple annual rate of the index between two moments, in % a year. */
export function indexWindowRate(index, fromAt, toAt) {
  if (!index?.series?.length || !(toAt > fromAt)) return null;
  const tolerance = Math.max(1.1 * DAY, (toAt - fromAt) * 0.1);
  const a = nearest(index.series, fromAt, tolerance);
  const b = nearest(index.series, toAt, tolerance);
  if (!a || !b || !(b.at > a.at)) return null;
  return ((b.level / a.level - 1) * 365 * DAY * 100) / (b.at - a.at);
}

/** The index over the last `days`, ending at its latest reading. */
export function indexTrailingRate(index, days) {
  if (!index?.series?.length) return null;
  const end = index.series.at(-1);
  const from = end.at - days * DAY;
  if (index.series[0].at > from + 1.1 * DAY) return null;
  return indexWindowRate(index, from, end.at);
}

/** A level series as growth of 100 from the first reading at or after `fromAt`. */
export function rebase(series, fromAt = -Infinity) {
  const list = series || [];
  // Start at the reading nearest the start, so two lines begin on the same day.
  let first = list.findIndex((point) => point.at >= fromAt);
  if (first > 0 && fromAt - list[first - 1].at < list[first].at - fromAt)
    first -= 1;
  const inside = first < 0 ? [] : list.slice(first);
  if (inside.length < 2) return [];
  const base = inside[0].level;
  return inside.map((point) => ({ at: point.at, value: (point.level / base) * 100 }));
}

/** Constituents added up by network or by protocol. */
export function groupConstituents(constituents, by) {
  const groups = new Map();
  for (const row of constituents || []) {
    const name = by === "network" ? row.network : row.protocol;
    const group = groups.get(name) || { name, tvl: 0, rated: 0, rateSum: 0, count: 0 };
    group.tvl += row.tvl;
    group.count += 1;
    if (row.rate != null) {
      group.rated += row.tvl;
      group.rateSum += row.tvl * row.rate;
    }
    groups.set(name, group);
  }
  const total = [...groups.values()].reduce((s, g) => s + g.tvl, 0);
  return [...groups.values()]
    .map((group) => ({
      ...group,
      weight: total ? (group.tvl / total) * 100 : 0,
      rate: group.rated ? group.rateSum / group.rated : null,
    }))
    .sort((a, b) => b.tvl - a.tvl);
}

/**
 * Each market's own daily rate, earned between consecutive readings, as a
 * simple annual rate in %, keyed by market. The latest reading's size, quoted
 * rate and names come along, so a list of markets needs nothing else.
 */
export function marketVenues(rows, { symbol = null, minSize = MIN_MEMBER_SIZE } = {}) {
  const byKey = new Map();
  for (const row of rows || []) {
    if (symbol && row.symbol !== symbol) continue;
    if (!(row.idx > 0)) continue;
    if (!byKey.has(row.key)) byKey.set(row.key, []);
    byKey.get(row.key).push(row);
  }
  const venues = [];
  for (const [key, list] of byKey) {
    list.sort((a, c) => a.day - c.day);
    const latest = list.at(-1);
    if (!(latest.tvl >= minSize)) continue;
    const daily = [];
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1],
        c = list[i];
      const span = c.at - a.at;
      if (!(span > 0) || span > 7 * DAY) continue;
      const rate = ((c.idx / a.idx - 1) * 365 * DAY * 100) / span;
      if (Number.isFinite(rate) && Math.abs(rate) < 100)
        daily.push({ day: c.day, at: c.at, rate, tvl: c.tvl });
    }
    venues.push({
      key,
      network: latest.network,
      name: latest.name,
      protocol: latest.protocol,
      symbol: latest.symbol,
      tvl: latest.tvl,
      rate: latest.rate,
      at: latest.rateAt ?? latest.at,
      vaults: latest.vaults || [],
      daily,
    });
  }
  return venues.sort((a, c) => c.tvl - a.tvl);
}

/** At each point of a level series, what it earned over the previous `days`, a year. */
export function earnedSeries(series, days = 7) {
  const out = [];
  for (let i = 0; i < (series || []).length; i++) {
    const end = series[i];
    let start = null;
    for (let j = i - 1; j >= 0; j--)
      if (end.at - series[j].at >= (days - 0.5) * DAY) {
        start = series[j];
        break;
      }
    if (start)
      out.push({
        at: end.at,
        rate: ((end.level / start.level - 1) * 365 * DAY * 100) / (end.at - start.at),
      });
  }
  return out;
}

/**
 * A vault's 7-day earnings against the index's over the same week, at each
 * reading since `fromAt`: the gap in points, and both rates.
 */
export function gapSeries(levels, index, fromAt = -Infinity) {
  const ours = earnedSeries(levels, 7).filter((point) => point.at >= fromAt);
  const theirs = index?.earned || [];
  if (!theirs.length) return [];
  return ours
    .map((point) => {
      const near = theirs.reduce((best, item) =>
        Math.abs(item.at - point.at) < Math.abs(best.at - point.at) ? item : best,
      );
      if (Math.abs(near.at - point.at) > 1.1 * DAY) return null;
      return { at: point.at, ours: point.rate, index: near.rate, gap: point.rate - near.rate };
    })
    .filter(Boolean);
}

/**
 * Calendar weeks ending at the latest reading, oldest first: what the vault and
 * the index each earned over the same week, a year, and the gap in points.
 * Weeks do not overlap.
 */
export function weeklyGaps(levels, index, fromAt = -Infinity) {
  if (!levels?.length || !index?.series?.length) return [];
  const end = Math.min(levels.at(-1).at, index.series.at(-1).at);
  const out = [];
  let to = end;
  for (; to - 7 * DAY >= fromAt - DAY / 2; to -= 7 * DAY) {
    const from = to - 7 * DAY;
    const ours = indexWindowRate({ series: levels }, from, to);
    const theirs = indexWindowRate(index, from, to);
    if (ours == null || theirs == null) return out.reverse();
    out.push({ at: to, from, ours, index: theirs, gap: ours - theirs });
  }
  // The days left before the first whole week are a short bar of their own,
  // so the bars cover exactly the period of the figure above them.
  const start = Math.max(fromAt, levels[0].at, index.series[0].at);
  if (to - start >= DAY) {
    const ours = indexWindowRate({ series: levels }, start, to);
    const theirs = indexWindowRate(index, start, to);
    if (ours != null && theirs != null)
      out.push({ at: to, from: start, ours, index: theirs, gap: ours - theirs, partial: true });
  }
  // Each bar's part of the whole gap: its yearly gap weighted by its share of
  // the days, so a short period stays short and the bars add up to the gap
  // over the whole span.
  const span = out.reduce((sum, week) => sum + (week.at - week.from), 0);
  for (const week of out)
    week.share = span ? (week.gap * (week.at - week.from)) / span : null;
  return out.reverse();
}
