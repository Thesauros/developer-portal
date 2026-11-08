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
export const marketColor = (name) => MARKET_COLOR[marketName(name)] || "#5f7183";
export const CASH_COLOR = "#a9b8c7";
// Network colours, used only where capital is grouped by network.
const NETWORK_COLOR = {
  Ethereum: "#4f5b93",
  Arbitrum: "#2d8fd5",
  Base: "#0b3fd1",
  Monad: "#6e54d8",
  Plasma: "#1d7a62",
};
// Live needs both: enough money to measure, and code an outside firm has
// reviewed in the version that is deployed.
const stageOf = (tvl, audit) =>
  tvl == null
    ? null
    : tvl >= MIN_MEASURED_TVL && audit?.state === "reviewed"
      ? "Live"
      : "Early";

function rates(samples, now) {
  const r30 = measuredRate(samples, 30, { now });
  const r7 = measuredRate(samples, 7, { now });
  return { r30, r7, grown: sinceMeasurable(samples, { now }) };
}

// Every vault belongs to one product: the stablecoin it holds and how you get
// out. The network is where a particular vault of that product takes deposits,
// so it is a choice inside the product, not its name.
export const PRODUCTS = {
  "USDC:instant": {
    id: "usdc-instant",
    token: "USDC",
    kind: "instant",
    tag: "Instant",
    line: "Withdraw any time, in one transaction.",
    short: "Leave any time",
  },
  "USDC:batch": {
    id: "usdc-multichain",
    token: "USDC",
    kind: "batch",
    tag: "Multichain",
    line: "One deposit, lent across networks. Withdrawals settle in batches.",
    short: "One deposit, lent across networks",
  },
  "USDT0:instant": {
    id: "usdt0-instant",
    token: "USDT0",
    kind: "instant",
    tag: "Instant",
    line: "Withdraw any time, in one transaction.",
    short: "Leave any time",
  },
};
const productOf = (token, kind) =>
  PRODUCTS[token + ":" + kind] || {
    id: (token + "-" + kind).toLowerCase(),
    token,
    kind,
    tag: kind === "batch" ? "Multichain" : "Instant",
    line: "",
  };

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
  const product = productOf(row.token, "instant");
  return {
    id: row.id,
    kind: "instant",
    product,
    title: row.token + " " + product.tag,
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
    stage: stageOf(tvl, facts.audit),
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
    open: {
      deposits: !(ready?.depositPaused ?? terms?.depositPaused ?? false),
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
  const product = productOf("USDC", "batch");
  const reach = crosschain.networks.map((net) => net.name);
  return {
    id: BATCH_VAULT_ID,
    kind: "batch",
    product,
    title: "USDC " + product.tag,
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
    stage: "Pilot",
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
  const byDay = new Map();
  for (const point of vault.samples || []) {
    if (!(point.price > 0) || !(point.tvl > 0)) continue;
    byDay.set(Math.floor(point.at / DAY), point);
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
  // The combined size never fell below the floor: each vault's smallest size
  // inside the window, added up, so a missed reading does not look like a dip.
  const lowest = new Map();
  for (const row of rows)
    if (row.at >= fromAt - DAY / 2)
      lowest.set(row.key, Math.min(lowest.get(row.key) ?? Infinity, row.tvl));
  const smallest = [...lowest.values()].reduce((sum, value) => sum + value, 0);
  return {
    status: smallest >= MIN_MEASURED_TVL ? "ok" : "small",
    rate,
    days,
    from: { at: fromAt },
    to: { at: end.at },
    series: built.series,
  };
}

// The same comparison everywhere: against the blue-chip index on the same days.
function againstIndex(rateNow, measure, index) {
  if (!index) return null;
  const r30 =
    measure?.from && measure?.to
      ? indexWindowRate(index, measure.from.at, measure.to.at)
      : null;
  return {
    now: index.rateNow,
    nowDiff:
      rateNow != null && index.rateNow != null ? rateNow - index.rateNow : null,
    r30,
    r30Diff:
      measure?.status === "ok" && r30 != null ? measure.rate - r30 : null,
  };
}

// A group's 30-day rate is the size-weighted rate of its vaults that are large
// enough to measure, so a product never shows a different figure from the vault
// that makes it up. The chained series is only drawn, never quoted.
function groupMeasure(members, index, now) {
  const chained = compositeMeasure(members, 30, now);
  const ok = members.filter(
    (vault) => vault.measured.r30.status === "ok" && vault.tvl > 0,
  );
  if (!ok.length)
    return {
      measure: { ...chained, status: chained.status === "ok" ? "small" : chained.status },
      vs: null,
    };
  const total = ok.reduce((sum, vault) => sum + vault.tvl, 0);
  const avg = (pick) =>
    ok.every((vault) => pick(vault) != null)
      ? ok.reduce((sum, vault) => sum + vault.tvl * pick(vault), 0) / total
      : null;
  return {
    measure: {
      status: "ok",
      rate: avg((vault) => vault.measured.r30.rate),
      days: 30,
      from: { at: Math.min(...ok.map((vault) => vault.measured.r30.from.at)) },
      to: { at: Math.max(...ok.map((vault) => vault.measured.r30.to.at)) },
      series: chained.series,
      covered: ok.length,
    },
    vs: {
      r30: avg((vault) => vault.vsIndex?.r30),
      r30Diff: avg((vault) => vault.vsIndex?.r30Diff),
    },
  };
}

const STAGE_RANK = { Live: 3, Pilot: 2, Early: 1 };
const sizeWeightedRate = (vaults) => {
  const sized = vaults.filter((vault) => vault.tvl > 0);
  const total = sized.reduce((sum, vault) => sum + vault.tvl, 0);
  if (!total || sized.some((vault) => vault.rateNow == null)) return null;
  return sized.reduce((sum, vault) => sum + vault.tvl * vault.rateNow, 0) / total;
};

function products(vaults, indexFor, now) {
  const groups = new Map();
  for (const vault of vaults) {
    const key = vault.product.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(vault);
  }
  return [...groups.values()]
    .map((members) => {
      const sorted = [...members].sort((a, c) => (c.tvl ?? -1) - (a.tvl ?? -1));
      const index = indexFor(sorted[0].token);
      const { measure: r30, vs } = groupMeasure(sorted, index, now);
      const rateNow = sizeWeightedRate(sorted);
      return {
        ...sorted[0].product,
        title: sorted[0].token + " " + sorted[0].product.tag,
        vaults: sorted,
        lead: sorted[0],
        index,
        tvl: sorted.reduce((sum, vault) => sum + (vault.tvl ?? 0), 0),
        rateNow,
        rateRange: (() => {
          const known = sorted.map((vault) => vault.rateNow).filter((r) => r != null);
          return known.length ? [Math.min(...known), Math.max(...known)] : null;
        })(),
        measured: { r30 },
        vsIndex: index
          ? {
              now: index.rateNow,
              nowDiff:
                rateNow != null && index.rateNow != null
                  ? rateNow - index.rateNow
                  : null,
              r30: vs?.r30 ?? null,
              r30Diff: vs?.r30Diff ?? null,
            }
          : null,
        stage: sorted
          .map((vault) => vault.stage)
          .sort((a, c) => (STAGE_RANK[c] || 0) - (STAGE_RANK[a] || 0))[0],
        networks: [...new Set(sorted.flatMap((vault) => vault.networks))],
        places: sorted.map((vault) => vault.place),
        exit: sorted[0].exit,
        position: {
          balance: sorted.reduce(
            (sum, vault) => sum + (vault.position.balance || 0),
            0,
          ),
        },
      };
    })
    // A pilot comes after everything that is past it, whatever its size.
    .sort(
      (a, c) =>
        (a.stage === "Pilot") - (c.stage === "Pilot") || c.tvl - a.tvl,
    );
}

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
  includeBatch = true,
  depositsOpen = false,
  index: rawIndex = null,
  indexes: rawIndexes = null,
  markets = null,
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
  const indexFor = (token) => indexes[token] || null;
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
  const vaults = rows.map((row) =>
    standardView(
      row,
      chainRows.find((item) => item.id === row.id),
      mine?.vaults?.find((item) => item.vaultId === row.id),
      samples[row.id],
      now,
    ),
  );
  if (includeBatch)
    vaults.push(batchView(batch, ticks, depositsOpen, now));
  vaults.sort((a, b) => (b.tvl ?? -1) - (a.tvl ?? -1));
  if (markets?.length) for (const vault of vaults) readMarkets(vault, markets);
  for (const vault of vaults) {
    vault.index = indexFor(vault.token);
    vault.vsIndex = againstIndex(vault.rateNow, vault.measured.r30, vault.index);
  }
  // Thesauros as a whole means its USDC vaults: nearly all of the money, and
  // one yardstick for it.
  const usdc = vaults.filter((vault) => vault.token === "USDC");
  const all = groupMeasure(usdc, index, now);
  const allR30 = all.measure;
  const allRate = sizeWeightedRate(usdc);
  const measurable = vaults.filter((vault) => vault.tvl != null);
  const held = vaults.filter(
    (vault) => vault.position.known && vault.position.balance > 0,
  );
  const unreadable = vaults.filter((vault) => !vault.position.known);
  const balance = held.reduce((sum, vault) => sum + vault.position.balance, 0);
  const earnedKnown = held.filter((vault) => vault.position.earned != null);
  const weightedRate =
    balance > 0 && held.every((vault) => vault.rateNow != null)
      ? held.reduce(
          (sum, vault) => sum + vault.position.balance * vault.rateNow,
          0,
        ) / balance
      : null;
  const productList = products(vaults, indexFor, now);
  return {
    vaults,
    byId: Object.fromEntries(vaults.map((vault) => [vault.id, vault])),
    products: productList,
    productOf: Object.fromEntries(
      productList.flatMap((product) =>
        product.vaults.map((vault) => [vault.id, product]),
      ),
    ),
    index,
    indexes,
    totals: {
      tokens: "USDC",
      rateNow: allRate,
      measured: { r30: allR30 },
      vsIndex: index
        ? {
            now: index.rateNow,
            nowDiff:
              allRate != null && index.rateNow != null
                ? allRate - index.rateNow
                : null,
            r30: all.vs?.r30 ?? null,
            r30Diff: all.vs?.r30Diff ?? null,
          }
        : null,
      tvl: measurable.reduce((sum, vault) => sum + vault.tvl, 0),
      complete: measurable.length === vaults.length,
      unit: totalUnit(vaults),
      networks: new Set(vaults.flatMap((vault) => vault.networks)).size,
      since: Math.min(
        ...vaults.map((vault) => vault.since ?? Infinity),
      ),
    },
    account: {
      held,
      balance,
      atLeast: unreadable.length > 0,
      unit: totalUnit(held),
      // Added up only from vaults whose history explains the balance, and it says so.
      earned: earnedKnown.length
        ? earnedKnown.reduce((sum, vault) => sum + vault.position.earned, 0)
        : null,
      earnedPartial: earnedKnown.length > 0 && earnedKnown.length < held.length,
      rateNow: weightedRate,
      perMonth: weightedRate == null ? null : (balance * weightedRate) / 100 / 12,
      wallet: walletBalances(vaults),
      attention: vaults.flatMap((vault) =>
        (vault.position.active || []).map((request) => ({ vault, request })),
      ),
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

// A product's page shows the product, added up across its networks. The network
// a person deposits from is chosen in the deposit panel; per-network figures sit
// in the networks section.
export function productView(product) {
  const vaults = product.vaults;
  const lead = product.lead;
  if (vaults.length === 1) return { ...lead, productId: product.id, members: vaults };
  const total = product.tvl || 0;
  const allocation = vaults
    .flatMap((vault) =>
      vault.allocation.map((row) => ({
        ...row,
        key: vault.id + ":" + row.key,
        vaultId: vault.id,
        network: row.network || vault.place,
      })),
    )
    .filter((row) => (row.amount ?? 0) > 0)
    .map((row) => ({ ...row, share: total ? (row.amount / total) * 100 : null }))
    .sort((a, c) => (c.amount || 0) - (a.amount || 0));
  // Each day's split across every vault of the product, added up by market.
  const byDay = new Map();
  for (const vault of vaults)
    for (const point of vault.samples || []) {
      if (!point.allocation?.length) continue;
      const day = Math.floor(point.at / DAY);
      const entry = byDay.get(day) || { at: point.at, allocation: [] };
      entry.allocation.push(...point.allocation);
      byDay.set(day, entry);
    }
  const records = vaults.map((vault) => vault.exit.record).filter(Boolean);
  const stages = new Map();
  for (const vault of vaults) {
    if (!stages.has(vault.stage)) stages.set(vault.stage, []);
    stages.get(vault.stage).push(vault.place);
  }
  return {
    ...lead,
    id: product.id,
    productId: product.id,
    members: vaults,
    title: product.title,
    place: product.networks.join(", "),
    networks: product.networks,
    networkLabel: product.networks.join(", "),
    marks: vaults.flatMap((vault) => vault.marks),
    tvl: total,
    rateNow: product.rateNow,
    measured: { ...lead.measured, r30: product.measured.r30 },
    vsIndex: product.vsIndex,
    stage: product.stage,
    stages: [...stages].map(([stage, places]) => ({ stage, places })),
    since: Math.min(...vaults.map((vault) => vault.since ?? Infinity)),
    allocation,
    allocationHistory: allocationHistory(
      [...byDay.values()].sort((a, c) => a.at - c.at),
    ),
    onlyMarket: null,
    moves: vaults
      .flatMap((vault) => vault.moves)
      .sort((a, c) => (c.at || 0) - (a.at || 0)),
    movesComplete: vaults.every((vault) => vault.movesComplete),
    exit: {
      ...lead.exit,
      // Added up where the monitor measures it; shown when that covers
      // practically all of the money (a network it does not watch yet may
      // hold a dollar).
      capacity: (() => {
        const known = vaults.filter((vault) => vault.exit.capacity);
        const covered = known.reduce((sum, vault) => sum + (vault.tvl || 0), 0);
        if (!known.length || covered < total * 0.999) return null;
        return {
          canLeave: known.reduce((sum, vault) => sum + vault.exit.capacity.canLeave, 0),
          held: known.reduce((sum, vault) => sum + vault.exit.capacity.held, 0),
          markets: known.flatMap((vault) =>
            vault.exit.capacity.markets.map((market) => ({
              ...market,
              network: vault.place,
            })),
          ),
          cash: known.reduce((sum, vault) => sum + (vault.exit.capacity.cash || 0), 0),
          at: known[0].exit.capacity.at,
          partial: known.length < vaults.length,
        };
      })(),
      record: records.length
        ? {
            count: records.reduce((sum, record) => sum + record.count, 0),
            largest: Math.max(...records.map((record) => record.largest)),
            partial: records.length < vaults.length,
          }
        : null,
    },
    contracts: vaults.flatMap((vault) =>
      vault.contracts.map((contract) => ({
        ...contract,
        label: contract.label + " on " + vault.place,
      })),
    ),
    // Risks of the largest vault, and anything different on another network.
    risks: [
      ...lead.risks,
      ...vaults
        .filter((vault) => vault !== lead)
        .flatMap((vault) =>
          vault.risks
            .filter(
              (risk) =>
                !lead.risks.some(
                  (own) => own.title === risk.title && own.text === risk.text,
                ),
            )
            .map((risk) => ({ ...risk, title: `${risk.title}, on ${vault.place}` })),
        ),
    ],
  };
}

export const PRODUCT_IDS = Object.values(PRODUCTS).map((product) => product.id);
