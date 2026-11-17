// One model for every vault and one account across them. Each screen reads from
// here, so a vault looks the same wherever it appears and differs only where its
// mechanics do. Pure: inputs come from the data hooks, nothing is fetched.
import { vaults as standardVaults } from "./vault-contracts.mjs";
import { crosschain, marketInfo } from "./crosschain-config.mjs";
import {
  allMarkets,
  batchPosition,
  capitalMap,
  crosschainEarned,
  rateOnAllCapital,
  valuationState,
} from "./crosschain-feed.mjs";
import {
  DAY,
  MIN_MEASURED_TVL,
  measuredRate,
  sinceMeasurable,
  valuationGaps,
} from "./vault-metrics.mjs";
import { chainById, chainList } from "./chains.mjs";
import {
  buildBlueChipIndex,
  indexTrailingRate,
  indexWindowRate,
  MIN_MEMBER_SIZE,
} from "./blue-chip-index.mjs";
import {
  BATCH_VAULT_ID,
  PLANNED_PERFORMANCE_FEE,
  VAULT_FACTS,
} from "./vault-facts.mjs";

export const NETWORK_ICON = Object.fromEntries(
  chainList.map((chain) => [chain.name, chain.icon]),
);
const units = (value, decimals = 6) =>
  value == null ? null : Number(value) / 10 ** decimals;
// Vendors call the same market different things across data sources.
export const marketName = (name) =>
  String(name || "Lending market").replace(/ Morpho$/, "");
// Colour follows the market, never its rank. Curated vaults of one curator
// share a hue family.
const MARKET_COLOR = {
  "Aave V3": "#196aff",
  "Compound V3": "#0b8f7b",
  "Gauntlet Core": "#7b5bd6",
  "Gauntlet Prime": "#5a3fb8",
  "Steakhouse High Yield": "#c77a12",
  "Steakhouse Prime": "#c44b8a",
  Steakhouse: "#a8620f",
  Smokehouse: "#8a5a3c",
  Fluid: "#2f8fd8",
  Kamino: "#3a9a5b",
};
export const marketColor = (name) =>
  name === "Other markets" ? "#c9d3dd" : MARKET_COLOR[marketName(name)] || "#5f7183";
export const CASH_COLOR = "#a9b8c7";
// Network colours, used only where capital is grouped by network.
const NETWORK_COLOR = {
  Ethereum: "#4f5b93",
  Arbitrum: "#2d8fd5",
  Base: "#0b3fd1",
  Monad: "#6e54d8",
  Plasma: "#1d7a62",
};
function rates(samples, now) {
  const r30 = measuredRate(samples, 30, { now });
  const r7 = measuredRate(samples, 7, { now });
  return { r30, r7, grown: sinceMeasurable(samples, { now }) };
}

// Thesauros runs one product: a USDC vault that takes one deposit and lends it
// across networks. The vaults that came before it, one per network, keep their
// history and their holders' positions and take no new deposits; holders move
// from them to the product.
export const PRODUCT = Object.freeze({
  id: "usdc-multichain",
  token: "USDC",
  kind: "batch",
  tag: "Multichain",
  line: "One deposit, lent across networks. Deposits and withdrawals settle in batches.",
  short: "One deposit, lent across networks",
});
// What a previous vault is called wherever it still appears.
export const previousTitle = (token, network) => `${token} on ${network}`;

function standardView(row, chainRow, mineRow, samples, now) {
  const contract = standardVaults.find((vault) => vault.id === row.id);
  const facts = VAULT_FACTS[row.id];
  const ready = chainRow?.status === "ready" ? chainRow : null;
  const tvl =
    ready?.totalAssets != null
      ? units(ready.totalAssets, row.decimals)
      : (row.exitNow?.held ?? row.tvl);
  const balance = ready
    ? units(ready.positionAssets, row.decimals)
    : (mineRow?.balance ?? null);
  const providers = row.providers || [];
  // Positions read from the contracts, when there is a reading: every row and
  // the total then come from one moment, and uninvested cash is its own row.
  const positions = row.exitNow?.markets?.length ? row.exitNow : null;
  // With a reading of positions, every position is a row, however small; the
  // monitor only lends names, logos and groups.
  const fromPositions = () =>
    positions.markets
      .filter((market) => market.position > 0)
      .map((market) => {
        const meta = providers.find(
          (provider) => marketName(provider.name) === market.name,
        );
        return {
          key: row.id + ":" + (meta?.address || market.name),
          kind: "market",
          name: market.name,
          logo:
            meta?.logo ||
            { Aave: "aave", Compound: "compound", Morpho: "morpho", Fluid: "fluid" }[
              market.protocol
            ] ||
            null,
          tier:
            meta?.riskTier ||
            (market.protocol === "Aave" || market.protocol === "Compound"
              ? "core"
              : "satellite"),
          network: row.network,
          address: meta?.address || null,
          explorer: row.explorer,
          rate: meta?.apy ?? null,
          share: (market.position / positions.held) * 100,
          amount: market.position,
          limit: null,
        };
      });
  const allocation = (positions
    ? fromPositions()
    : providers
        .filter((provider) => (provider.share ?? 0) > 0)
        .map((provider) => ({
          key: row.id + ":" + provider.address,
          kind: "market",
          name: marketName(provider.name),
          logo: provider.logo,
          tier: provider.riskTier,
          network: row.network,
          address: provider.address,
          explorer: row.explorer,
          rate: provider.apy,
          share: provider.share,
          amount: tvl != null ? (tvl * provider.share) / 100 : null,
          limit: null,
        }))
  ).sort((a, b) => (b.amount || 0) - (a.amount || 0));
  if (positions && positions.cash >= 0.01)
    allocation.push({
      key: row.id + ":idle",
      kind: "idle",
      name: "Uninvested in the vault",
      network: row.network,
      rate: 0,
      amount: positions.cash,
      share: (positions.cash / positions.held) * 100,
    });
  const measured = rates(samples, now);
  const terms = row.facts;
  const feeOf = (live, read) =>
    live != null
      ? Number(live) / 1e16
      : read != null
        ? Number(read) / 1e16
        : null;
  const singleMarket = new Set(allocation.map((entry) => entry.name)).size <= 1;
  // The server gives a figure only when the event history explains the wallet's
  // exact share balance.
  const earned = mineRow?.reconciled ? (mineRow.earned ?? null) : null;
  return {
    id: row.id,
    kind: "instant",
    previous: true,
    title: previousTitle(row.token, row.network),
    place: row.network,
    token: row.token,
    decimals: row.decimals,
    networks: [row.network],
    networkLabel: row.network,
    depositNetwork: row.network,
    chainId: contract?.chainId,
    gasToken: contract?.gasToken,
    marks: [{ network: row.network, icon: NETWORK_ICON[row.network] }],
    explorer: row.explorer,
    address: row.address || contract?.address,
    contracts: [
      { label: "Vault", address: row.address || contract?.address, explorer: row.explorer },
    ],
    stage: "Previous",
    audit: facts.audit,
    notice: null,
    risks: facts.risks,
    since: samples?.[0]?.at ?? null,
    tvl,
    rateNow: row.apyNow ?? null,
    measured,
    samples: samples || [],
    onlyMarket:
      singleMarket && allocation[0]
        ? `All in ${allocation[0].name} on ${row.network}.`
        : null,
    rateHistory: row.series || { vault: [], market: [] },
    allocationHistory: allocationHistory(samples),
    sharePrice:
      ready?.sharePrice != null
        ? units(ready.sharePrice, row.decimals)
        : (samples?.at(-1)?.price ?? null),
    allocation,
    capital: null,
    moves: (row.rebalances || []).map((event) => ({
      kind: "rebalance",
      at: event.at,
      amount: event.amount,
      token: row.token,
      fromName: marketName(event.fromName || "A market"),
      toName: marketName(event.toName || "another market"),
      txHash: event.txHash,
      url: row.explorer + "/tx/" + event.txHash,
      vaultId: row.id,
    })),
    movesComplete: row.rebalanceHistoryComplete ?? false,
    fees: {
      performance: feeOf(ready?.performanceFee, terms?.performanceFee),
      management: feeOf(ready?.managementFee, terms?.managementFee),
      planned: PLANNED_PERFORMANCE_FEE,
    },
    minDeposit: units(ready?.minAssets ?? terms?.minAssets, row.decimals),
    // A previous vault takes no new deposits here, whatever its contract allows.
    open: {
      deposits: false,
      withdrawals: !(ready?.withdrawPaused ?? terms?.withdrawPaused ?? false),
    },
    exit: {
      label: "Now",
      note: "in one transaction",
      detail: "Paid straight away, up to the liquidity its markets have.",
      record: row.exitRecord ?? null,
      // Market by market: the smaller of the vault's position and that
      // market's free cash, plus uninvested cash. Read from the contracts.
      capacity: row.exitNow ?? null,
    },
    position: {
      known: balance != null,
      balance,
      earned,
      earning: balance,
      shares: ready ? units(ready.shares, row.decimals) : null,
      inWallet: ready ? units(ready.cash, row.decimals) : null,
      requests: [],
      chain: chainRow || null,
    },
  };
}

function batchView(feed, ticks, depositsOpen, now) {
  const hub = crosschain.networks.find((net) => net.role === "hub") || crosschain.networks[0];
  const { vault, allocation, user, activity } = feed || {};
  const facts = VAULT_FACTS[BATCH_VAULT_ID];
  const map = capitalMap(vault, allocation);
  const samples = (ticks || [])
    .map((tick) => ({
      at: tick.at,
      price: Number(tick.rateBid) / 1e18,
      tvl: Number(tick.navBid) / 1e6,
    }))
    .filter((point) => point.at != null && Number.isFinite(point.price));
  const tvl = units(vault?.tick?.navBid);
  const measured = rates(samples, vault?.observedAt ?? now);
  const position = batchPosition(user);
  const requests = user?.requests || [];
  const active = requests.filter(
    (request) => !["claimed", "cancelled"].includes(request.state),
  );
  const rows = map
    ? [
        ...allMarkets(map)
          .filter((row) => row.amount > 0)
          .map((row) => ({ ...row, kind: "market" })),
        ...map.networks
          .filter((net) => net.idle > 0)
          .map((net) => ({
            key: net.key + ":idle",
            kind: "idle",
            name: "Not yet lent",
            network: net.name,
            rate: 0,
            amount: net.idle,
            share: (net.idle / map.held) * 100,
          })),
        ...(map.free > 0
          ? [
              {
                key: "cash",
                kind: "cash",
                name: "Cash for withdrawals",
                network: hub.name,
                rate: 0,
                amount: map.free,
                share: map.cashShare,
              },
            ]
          : []),
        ...(map.pendingDeposits > 0
          ? [
              {
                key: "pending",
                kind: "cash",
                name: "Deposits waiting to settle",
                network: hub.name,
                rate: null,
                amount: map.pendingDeposits,
                share: map.pendingShare,
              },
            ]
          : []),
        ...(map.owed > 0
          ? [
              {
                key: "owed",
                kind: "cash",
                name: "Owed to settled withdrawals",
                network: hub.name,
                rate: null,
                amount: map.owed,
                share: map.owedShare,
              },
            ]
          : []),
      ]
    : [];
  const gaps = valuationGaps(ticks, {
    maxAgeMs: (vault?.risk?.maxTickAge ?? 7200) * 1000,
    now: vault?.observedAt ?? now,
  });
  const longestGap = Math.max(0, ...gaps.gaps.map((gap) => gap.hours));
  const reach = crosschain.networks.map((net) => net.name);
  // Room left in the open batch: the contract takes a fixed amount of deposits
  // per batch and refuses the rest.
  const batchLimit = units(vault?.limits?.maxEpochDeposits);
  const batchTaken = units(vault?.accounting?.pendingDeposits) ?? 0;
  return {
    id: BATCH_VAULT_ID,
    kind: "batch",
    previous: false,
    product: PRODUCT,
    title: PRODUCT.token + " " + PRODUCT.tag,
    place: reach.join(" + "),
    token: "USDC",
    decimals: 6,
    networks: reach,
    networkLabel: reach.join(" + "),
    depositNetwork: hub.name,
    chainId: crosschain.chainId,
    gasToken: "ETH",
    marks: crosschain.networks.map((net) => ({
      network: net.name,
      icon: NETWORK_ICON[net.name],
    })),
    explorer: crosschain.explorer,
    address: crosschain.vault,
    contracts: [
      { label: "Vault on " + hub.name, address: crosschain.vault, explorer: crosschain.explorer },
      { label: "Valuation contract", address: crosschain.accountant, explorer: crosschain.explorer },
      ...crosschain.networks.flatMap((net) => [
        { label: net.name + " strategy", address: net.strategy, explorer: net.explorer },
        { label: net.name + " agent", address: net.agent, explorer: net.explorer },
      ]),
    ],
    stage: "Early",
    audit: facts.audit,
    notice: facts.notice,
    risks: facts.risks,
    since: samples[0]?.at ?? null,
    tvl,
    rateNow: rateOnAllCapital(map),
    measured,
    samples,
    onlyMarket: null,
    rateHistory: null,
    allocationHistory: null,
    sharePrice: vault?.tick?.rateBid != null ? Number(vault.tick.rateBid) / 1e18 : null,
    allocation: rows,
    capital: map,
    moves: [],
    movesComplete: true,
    fees: {
      performance:
        vault?.fees?.performanceFee != null
          ? Number(vault.fees.performanceFee) / 1e16
          : null,
      management:
        vault?.fees?.managementFee != null
          ? Number(vault.fees.managementFee) / 1e16
          : null,
      planned: PLANNED_PERFORMANCE_FEE,
    },
    minDeposit: units(vault?.limits?.minDeposit),
    limits: vault?.limits,
    batchLimit,
    batchRoom: batchLimit == null ? null : Math.max(0, batchLimit - batchTaken),
    open: {
      deposits: depositsOpen && (vault ? !vault.depositPaused : true),
      withdrawals: vault ? !vault.redeemPaused : true,
      closedByPolicy: !depositsOpen,
    },
    valuation: valuationState(vault),
    gaps,
    epoch: vault?.epoch,
    observedAt: vault?.observedAt,
    exit: {
      label: "Next batch",
      note: longestGap
        ? `longest wait so far ${Math.round(longestGap / 24)} days`
        : "no time promised",
      detail:
        "Requests settle together at the next valuation, then you collect. No time is promised.",
    },
    position: {
      known: !!position,
      balance: position?.total ?? null,
      earned: crosschainEarned(user, activity),
      earning: position?.earning ?? null,
      arriving: position?.arriving ?? 0,
      ready: position?.ready ?? 0,
      leaving: position?.leaving ?? 0,
      out: position?.out ?? 0,
      shares: units(user?.shares),
      inWallet: units(user?.cash),
      requests,
      active,
      chain: null,
    },
  };
}

// Each day's split between markets, from the contracts. Null until there is a
// real change to show: one market for the whole period needs no chart.
export function allocationHistory(samples) {
  const days = (samples || [])
    .filter((point) => point.allocation?.length)
    .map((point) => {
      const parts = new Map();
      for (const row of point.allocation) {
        const name = marketName(row.name);
        parts.set(name, (parts.get(name) || 0) + row.amount);
      }
      const total = [...parts.values()].reduce((sum, value) => sum + value, 0);
      return { at: point.at, total, parts };
    })
    .filter((day) => day.total > 0);
  // Markets that never held a tenth of the money are one band, so the chart
  // shows the moves that mattered.
  const peak = new Map();
  for (const day of days)
    for (const [name, value] of day.parts)
      peak.set(name, Math.max(peak.get(name) || 0, value / day.total));
  const minor = new Set([...peak].filter(([, share]) => share < 0.1).map(([name]) => name));
  if (minor.size > 1)
    for (const day of days) {
      let rest = 0;
      for (const name of minor) {
        rest += day.parts.get(name) || 0;
        day.parts.delete(name);
      }
      if (rest > 0) day.parts.set("Other markets", rest);
    }
  const names = new Set(days.flatMap((day) => [...day.parts.keys()]));
  if (days.length < 2 || names.size < 2) return null;
  const order = [...names].sort(
    (a, c) =>
      days.reduce((sum, day) => sum + (day.parts.get(c) || 0) / day.total, 0) -
      days.reduce((sum, day) => sum + (day.parts.get(a) || 0) / day.total, 0),
  );
  return {
    names: order,
    days: days.map((day) => ({
      at: day.at,
      total: day.total,
      shares: order.map((name) => ((day.parts.get(name) || 0) / day.total) * 100),
    })),
  };
}

// USDC and USDT0 are added at 1:1 and the total says so.
export function totalUnit(rows) {
  const tokens = new Set(rows.map((row) => row.token));
  return tokens.size === 1 ? [...tokens][0] : "USD";
}

// Stablecoins in the wallet, one line per token on each chain. The same USDC on
// Base is read twice, once for each vault that accepts it, and counts once.
export function walletBalances(vaults) {
  const seen = new Map();
  for (const vault of vaults) {
    const key = vault.depositNetwork + ":" + vault.token;
    const amount = vault.position.inWallet;
    if (amount == null) continue;
    if (!seen.has(key) || vault.kind === "instant")
      seen.set(key, {
        network: vault.depositNetwork,
        token: vault.token,
        amount,
      });
  }
  return [...seen.values()].filter((row) => row.amount > 0);
}

// Vault share prices chain-linked day by day exactly like the blue-chip index,
// so a product and the index are worked out the same way.
function dailyRows(vault) {
  // Readings sit near midnight, some just after it and some just before, so a
  // reading belongs to the nearest midnight: two readings on one calendar day
  // (00:04 and 23:57) are two days, not one.
  const byDay = new Map();
  for (const point of vault.samples || []) {
    if (!(point.price > 0) || !(point.tvl > 0)) continue;
    byDay.set(Math.round(point.at / DAY), point);
  }
  return [...byDay].map(([day, point]) => ({
    key: vault.id,
    day,
    at: point.at,
    idx: point.price,
    tvl: point.tvl,
  }));
}
export function compositeMeasure(vaults, days, now = Date.now()) {
  const rows = vaults.flatMap(dailyRows);
  const built = buildBlueChipIndex(rows, { now });
  if (!built || built.series.length < 2) return { status: "none" };
  const end = built.series.at(-1);
  const fromAt = end.at - days * DAY;
  if (built.series[0].at > fromAt + 1.1 * DAY)
    return { status: "young", series: built.series };
  const rate = indexWindowRate(built, fromAt, end.at);
  if (rate == null) return { status: "none", series: built.series };
  // The money as a whole never fell below the floor. Day by day, each vault at
  // its latest reading: money that moves from one vault to another stays
  // counted, and a vault's missed reading does not look like a dip. A vault
  // read as empty counts as empty: the chain above skips such readings, the
  // size here must not.
  const sizes = vaults.flatMap((vault) =>
    (vault.samples || [])
      .filter((point) => Number.isFinite(point.tvl) && point.tvl >= 0)
      .map((point) => ({ key: vault.id, day: Math.round(point.at / DAY), tvl: point.tvl })),
  );
  const days_ = [...new Set(sizes.map((row) => row.day))].sort((a, c) => a - c);
  const last = new Map();
  let smallest = Infinity;
  for (const day of days_) {
    for (const row of sizes) if (row.day === day) last.set(row.key, row.tvl);
    if (day * DAY < fromAt - DAY / 2) continue;
    let total = 0;
    for (const value of last.values()) total += value;
    smallest = Math.min(smallest, total);
  }
  return {
    status: smallest >= MIN_MEASURED_TVL ? "ok" : "small",
    rate,
    days,
    from: { at: fromAt },
    to: { at: end.at },
    series: built.series,
  };
}

// Gaps are worked out from the rates as they are shown, to the hundredth, so
// "3.70% against 4.07%" always reads −0.37.
export const shown = (rate) => (rate == null ? null : Math.round(rate * 100) / 100);
const gap = (a, c) => (a == null || c == null ? null : Math.round((shown(a) - shown(c)) * 100) / 100);

// The same comparison everywhere: against the Market Average on the same days.
function againstIndex(rateNow, measure, index) {
  if (!index) return null;
  const r30 =
    measure?.from && measure?.to
      ? indexWindowRate(index, measure.from.at, measure.to.at)
      : null;
  return {
    now: index.rateNow,
    nowDiff: gap(rateNow, index.rateNow),
    r30,
    r30Diff: measure?.status === "ok" ? gap(measure.rate, r30) : null,
  };
}

// The Thesauros record: every USDC vault, the product and the ones before it,
// chained day by day and weighted by the money each held. Money that moves from
// a previous vault to the product stays in one unbroken line, so the record
// follows depositors' money rather than one contract.
function thesaurosRecord(vaults, index, now) {
  const measure = compositeMeasure(vaults, 30, now);
  const r30 =
    index && measure.from && measure.to
      ? indexWindowRate(index, measure.from.at, measure.to.at)
      : null;
  // The gap in two parts, from the vaults that hold the money: what they did
  // among the markets on their own networks, and what those networks paid
  // against the whole Market Average.
  const placed = vaults.filter((vault) => vault.tvl > 0 && vault.local?.r30 != null);
  const total = placed.reduce((sum, vault) => sum + vault.tvl, 0);
  const localRate = total
    ? placed.reduce((sum, vault) => sum + vault.tvl * vault.local.r30, 0) / total
    : null;
  const ok = measure.status === "ok";
  return {
    measure,
    vs: index
      ? {
          r30,
          r30Diff: ok ? gap(measure.rate, r30) : null,
        }
      : null,
    local:
      ok && localRate != null
        ? {
            r30: localRate,
            selection: gap(measure.rate, localRate),
            place: gap(localRate, r30),
            networks: [...new Set(placed.flatMap((vault) => vault.networks))],
            parts: placed
              .filter((vault) => vault.local?.series?.length)
              .map((vault) => ({ tvl: vault.tvl, series: vault.local.series })),
          }
        : null,
  };
}

const sizeWeightedRate = (vaults) => {
  const sized = vaults.filter((vault) => vault.tvl > 0);
  const total = sized.reduce((sum, vault) => sum + vault.tvl, 0);
  if (!total || sized.some((vault) => vault.rateNow == null)) return null;
  return sized.reduce((sum, vault) => sum + vault.tvl * vault.rateNow, 0) / total;
};

// One rate per market everywhere: the reading the index uses, from the market's
// contract, with its time. Each market also says how big it is, how much of it
// the vault holds and whether the index counts it.
function readMarkets(vault, markets) {
  const byName = new Map(
    markets.map((market) => [
      (chainById(market.network)?.name || market.network) + "|" + market.name,
      market,
    ]),
  );
  let complete = true;
  for (const row of vault.allocation) {
    if (row.kind !== "market") continue;
    const market = byName.get(row.network + "|" + row.name);
    if (!market) {
      if ((row.amount || 0) > 0) complete = false;
      continue;
    }
    if (market.rate != null) {
      row.rate = market.rate;
      row.rateAt = market.at;
    } else if ((row.amount || 0) > 0) complete = false;
    row.marketSize = market.tvl;
    row.shareOfMarket = market.tvl > 0 ? ((row.amount || 0) / market.tvl) * 100 : null;
    row.inIndex = market.tvl >= MIN_MEMBER_SIZE && market.symbol === vault.token;
  }
  // The vault's rate now from those same readings: money at work, plus cash at
  // 0%; deposits waiting and amounts owed are not capital at work.
  const counted = vault.allocation.filter(
    (row) => row.kind === "market" || row.kind === "idle" || (row.kind === "cash" && row.rate === 0),
  );
  const total = counted.reduce((sum, row) => sum + (row.amount || 0), 0);
  if (complete && total > 0)
    vault.rateNow =
      counted.reduce((sum, row) => sum + (row.amount || 0) * (row.rate || 0), 0) / total;
  vault.ratesAt = Math.max(0, ...vault.allocation.map((row) => row.rateAt || 0)) || null;
}

export function buildBook({
  market,
  chainRows = [],
  mine,
  samples = {},
  batch,
  ticks,
  depositsOpen = true,
  index: rawIndex = null,
  indexes: rawIndexes = null,
  markets = null,
  networkIndexes = null,
  now = Date.now(),
}) {
  const withRates = (raw) =>
    raw
      ? {
          ...raw,
          r7: indexTrailingRate(raw, 7),
          r30: indexTrailingRate(raw, 30),
          r90: indexTrailingRate(raw, 90),
        }
      : null;
  // Each stablecoin is measured against the markets for that stablecoin.
  const index = withRates(rawIndex);
  const indexes = Object.fromEntries(
    Object.entries(rawIndexes || { USDC: rawIndex }).map(([symbol, raw]) => [
      symbol,
      symbol === "USDC" && raw === rawIndex ? index : withRates(raw),
    ]),
  );
  // An index of one market is that market, not a market average: a vault on
  // it is compared with nothing until a second market is approved.
  const indexFor = (token) =>
    indexes[token]?.constituents?.length >= 2 ? indexes[token] : null;
  const rows = market?.vaults?.length
    ? market.vaults
    : standardVaults.map((vault) => ({
        id: vault.id,
        network: vault.name,
        token: vault.symbol,
        decimals: vault.decimals,
        explorer: vault.explorer,
        address: vault.address,
        providers: [],
        series: { vault: [], market: [] },
      }));
  const previous = rows
    .map((row) =>
      standardView(
        row,
        chainRows.find((item) => item.id === row.id),
        mine?.vaults?.find((item) => item.vaultId === row.id),
        samples[row.id],
        now,
      ),
    )
    .sort((a, b) => (b.tvl ?? -1) - (a.tvl ?? -1));
  const vault = batchView(batch, ticks, depositsOpen, now);
  const vaults = [vault, ...previous];
  if (markets?.length) for (const item of vaults) readMarkets(item, markets);
  const chainIdOf = (name) => chainList.find((chain) => chain.name === name)?.id;
  for (const item of vaults) {
    item.index = indexFor(item.token);
    item.vsIndex = againstIndex(item.rateNow, item.measured.r30, item.index);
    const local =
      networkIndexes?.[item.token + ":" + item.networks.map(chainIdOf).join("+")] ||
      null;
    const m = item.measured.r30;
    const localRate =
      local && m?.from && m?.to ? indexWindowRate(local, m.from.at, m.to.at) : null;
    item.local = local
      ? {
          networks: item.networks,
          markets: local.markets,
          // The series travels too, so a page can split the gap over any
          // period the reader picks, not only 30 days.
          series: local.series,
          r30: localRate,
          selection: m?.status === "ok" ? gap(m.rate, localRate) : null,
          place: gap(localRate, item.vsIndex?.r30),
        }
      : null;
  }
  const usdc = vaults.filter((item) => item.token === "USDC");
  const record = thesaurosRecord(usdc, index, now);
  const product = {
    ...PRODUCT,
    title: vault.title,
    vault,
    index: vault.index || index,
    tvl: vault.tvl ?? null,
    rateNow: vault.rateNow,
    stage: vault.stage,
    networks: vault.networks,
    exit: vault.exit,
    // What Thesauros earned for depositors so far, the product's own days
    // included as they come.
    record: {
      ...record,
      // The product's own share price is enough to measure it once it has held
      // 10,000 USD for a month; until then the record is mostly the vaults
      // before it, and the page says so.
      own: vault.measured.r30.status === "ok",
      vs: index
        ? { ...record.vs, now: index.rateNow, nowDiff: gap(vault.rateNow, index.rateNow) }
        : null,
    },
  };
  const heldIn = (list) =>
    list.filter((item) => item.position.known && item.position.balance > 0);
  const held = heldIn([vault]);
  const previousHeld = heldIn(previous);
  const balance = vault.position.known ? vault.position.balance || 0 : 0;
  const earned = vault.position.earned ?? null;
  const rateNow = balance > 0 ? vault.rateNow : null;
  const previousSized = previous.filter((item) => item.tvl != null);
  const hubNetwork = vault.depositNetwork;
  const wallet = walletBalances(vaults);
  return {
    vault,
    product,
    previous,
    // Every vault with a contract behind it: the product first.
    vaults,
    byId: Object.fromEntries([
      ...vaults.map((item) => [item.id, item]),
      [PRODUCT.id, vault],
    ]),
    index,
    indexes,
    totals: {
      tokens: "USDC",
      rateNow: sizeWeightedRate(usdc),
      measured: { r30: record.measure },
      vsIndex: index
        ? {
            now: index.rateNow,
            nowDiff: gap(sizeWeightedRate(usdc), index.rateNow),
            r30: record.vs?.r30 ?? null,
            r30Diff: record.vs?.r30Diff ?? null,
          }
        : null,
      local: record.local,
      tvl: vault.tvl ?? null,
      // Money still in the vaults before the product, at face value.
      previousTvl: previousSized.reduce((sum, item) => sum + item.tvl, 0),
      previousUnit: totalUnit(previousSized.filter((item) => item.tvl > 0)),
      networks: vault.networks.length,
      since: Math.min(...usdc.map((item) => item.since ?? Infinity)),
    },
    account: {
      held,
      balance,
      known: vault.position.known,
      unit: PRODUCT.token,
      earned,
      rateNow,
      perMonth: rateNow == null ? null : (balance * rateNow) / 100 / 12,
      perYear: rateNow == null ? null : (balance * rateNow) / 100,
      // What the wallet can deposit right now, and what it holds elsewhere.
      wallet,
      ready: wallet.find(
        (row) => row.network === hubNetwork && row.token === PRODUCT.token,
      ) || null,
      attention: (vault.position.active || []).map((request) => ({ vault, request })),
      // Positions in the vaults before the product: to move or to withdraw.
      previous: previousHeld,
      previousBalance: previousHeld.reduce(
        (sum, item) => sum + item.position.balance,
        0,
      ),
      previousUnit: totalUnit(previousHeld),
      previousUnread: previous.filter((item) => !item.position.known).length,
    },
  };
}

// Where a set of positions (or whole vaults) sits, added up by market or network.
export function exposure(vaults, weightOf, by = "market") {
  const groups = new Map();
  let total = 0;
  for (const vault of vaults) {
    const weight = weightOf(vault);
    const shares = vault.allocation;
    const sum = shares.reduce((acc, row) => acc + (row.share || 0), 0);
    if (!(weight > 0) || !sum) continue;
    for (const row of shares) {
      const amount = (weight * (row.share || 0)) / sum;
      // A market on two networks is two markets with two rates.
      const name =
        by === "network"
          ? row.network
          : row.kind === "market"
            ? `${row.name}, ${row.network}`
            : "Cash and unlent";
      const group = groups.get(name) || {
        name,
        logo: by === "market" ? row.logo : null,
        kind: row.kind,
        amount: 0,
        rateSum: 0,
        icon: by === "network" ? NETWORK_ICON[row.network] : null,
        color:
          by === "market"
            ? row.kind === "market"
              ? marketColor(row.name)
              : CASH_COLOR
            : NETWORK_COLOR[row.network] || "#5f7183",
      };
      group.amount += amount;
      group.rateSum += amount * (row.rate || 0);
      groups.set(name, group);
      total += amount;
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      share: total ? (group.amount / total) * 100 : 0,
      rate: group.amount ? group.rateSum / group.amount : null,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export { DAY, MIN_MEASURED_TVL, marketInfo };

// Addresses that open the product's page: its own, and every address an older
// version of the app gave to a vault or a group of vaults.
export const PRODUCT_ALIASES = Object.freeze([
  PRODUCT.id,
  BATCH_VAULT_ID,
  "usdc-instant",
  "usdt0-instant",
  ...standardVaults.map((vault) => vault.id),
]);
