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
  indexRate,
  measuredRate,
  sinceMeasurable,
  valuationGaps,
} from "./vault-metrics.mjs";
import {
  BATCH_VAULT_ID,
  PLANNED_PERFORMANCE_FEE,
  VAULT_FACTS,
} from "./vault-facts.mjs";

const NETWORK_ICON = {
  Arbitrum: "/brand/tokens/arb.png",
  Base: "/brand/tokens/base.svg",
  Monad: "/brand/tokens/monad.png",
  Plasma: "/brand/tokens/plasma.png",
};
const units = (value, decimals = 6) =>
  value == null ? null : Number(value) / 10 ** decimals;
// Vendors call the same market different things across data sources.
export const marketName = (name) =>
  String(name || "Lending market").replace(/ Morpho$/, "");
const MARKET_COLOR = {
  "Aave V3": "#196aff",
  "Compound V3": "#0b8f7b",
  "Gauntlet Core": "#7b5bd6",
  "Steakhouse High Yield": "#c77a12",
  "Steakhouse Prime": "#c44b8a",
};
export const marketColor = (name) => MARKET_COLOR[marketName(name)] || "#5f7183";
export const CASH_COLOR = "#a9b8c7";
const stageOf = (tvl) =>
  tvl == null ? null : tvl >= MIN_MEASURED_TVL ? "Live" : "Early";

function rates(samples, now) {
  const r30 = measuredRate(samples, 30, { now });
  const r7 = measuredRate(samples, 7, { now });
  return { r30, r7, grown: sinceMeasurable(samples, { now }) };
}

// Aave on the network you deposit on, measured over the same window.
function benchmark(vaultRate, indexSamples, network) {
  if (!vaultRate?.from || !vaultRate?.to) return null;
  const rate = indexRate(indexSamples, vaultRate.from.at, vaultRate.to.at);
  return rate == null ? null : { name: "Aave V3 USDC on " + network, rate };
}

function standardView(row, chainRow, mineRow, samples, now) {
  const contract = standardVaults.find((vault) => vault.id === row.id);
  const facts = VAULT_FACTS[row.id];
  const ready = chainRow?.status === "ready" ? chainRow : null;
  const tvl =
    ready?.totalAssets != null ? units(ready.totalAssets, row.decimals) : row.tvl;
  const balance = ready
    ? units(ready.positionAssets, row.decimals)
    : (mineRow?.balance ?? null);
  const providers = row.providers || [];
  const allocation = providers
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
    .sort((a, b) => (b.amount || 0) - (a.amount || 0));
  const measured = rates(samples, now);
  const terms = row.facts;
  const feeOf = (live, read) =>
    live != null
      ? Number(live) / 1e16
      : read != null
        ? Number(read) / 1e16
        : null;
  const singleMarket =
    new Set(allocation.map((entry) => entry.name)).size <= 1 &&
    row.id !== "arbitrum" &&
    row.id !== "base";
  // The server gives a figure only when the event history explains the wallet's
  // exact share balance.
  const earned = mineRow?.reconciled ? (mineRow.earned ?? null) : null;
  return {
    id: row.id,
    kind: "instant",
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
    stage: stageOf(tvl),
    audit: facts.audit,
    notice: null,
    risks: facts.risks,
    since: samples?.[0]?.at ?? null,
    tvl,
    rateNow: row.apyNow ?? null,
    measured,
    samples: samples || [],
    benchmark:
      singleMarket || !["arbitrum", "base"].includes(row.id)
        ? null
        : benchmark(measured.r30.status === "none" ? null : measured.r30, samples, row.network),
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

function batchView(feed, ticks, baseSamples, depositsOpen, now) {
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
                network: "Base",
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
                network: "Base",
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
                network: "Base",
                rate: null,
                amount: map.owed,
                share: map.owedShare,
              },
            ]
          : []),
      ]
    : [];
  const baseRate = measured.r30;
  const gaps = valuationGaps(ticks, {
    maxAgeMs: (vault?.risk?.maxTickAge ?? 7200) * 1000,
    now: vault?.observedAt ?? now,
  });
  const longestGap = Math.max(0, ...gaps.gaps.map((gap) => gap.hours));
  return {
    id: BATCH_VAULT_ID,
    kind: "batch",
    token: "USDC",
    decimals: 6,
    networks: crosschain.networks.map((net) => net.name),
    networkLabel: crosschain.networks.map((net) => net.name).join(" + "),
    depositNetwork: "Base",
    chainId: crosschain.chainId,
    gasToken: "ETH",
    marks: crosschain.networks.map((net) => ({
      network: net.name,
      icon: NETWORK_ICON[net.name],
    })),
    explorer: crosschain.explorer,
    address: crosschain.vault,
    contracts: [
      { label: "Vault on Base", address: crosschain.vault, explorer: crosschain.explorer },
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
    benchmark: baseRate?.from
      ? benchmark(baseRate, baseSamples, "Base")
      : null,
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

export function buildBook({
  market,
  chainRows = [],
  mine,
  samples = {},
  batch,
  ticks,
  includeBatch = true,
  depositsOpen = false,
  now = Date.now(),
}) {
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
    vaults.push(batchView(batch, ticks, samples.base, depositsOpen, now));
  vaults.sort((a, b) => (b.tvl ?? -1) - (a.tvl ?? -1));
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
  return {
    vaults,
    byId: Object.fromEntries(vaults.map((vault) => [vault.id, vault])),
    totals: {
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
      const name =
        by === "network" ? row.network : row.kind === "market" ? row.name : "Cash and unlent";
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
            : null,
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
