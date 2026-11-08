// Market rates for the public market list and the Strategy Lab, from the
// Thesauros indexer's own readings of the markets its vaults may use. No outside
// data service: where the history database is not there, callers say so.
import { openCrosschainHistory } from "./crosschain-history.mjs";
import { readMarketSamples } from "./market-index.mjs";
import { marketVenues } from "./blue-chip-index.mjs";
import { chainById } from "./chains.mjs";
import { protocolLogo } from "./live-data.mjs";

export const MARKET_SOURCE =
  "Markets Thesauros vaults may use, read from their contracts by the Thesauros indexer.";

function readRows() {
  const store = openCrosschainHistory();
  try {
    return readMarketSamples(store);
  } finally {
    store.close();
  }
}

export function readMarketVenues({ symbol = null } = {}) {
  const venues = marketVenues(readRows(), { symbol });
  if (!venues.length) throw new Error("No market readings yet.");
  return venues;
}

// The public list: one row per market, latest size and rates.
export function marketList() {
  const venues = readMarketVenues();
  return {
    source: MARKET_SOURCE,
    updatedAt: new Date(Math.max(...venues.map((v) => v.at))).toISOString(),
    data: venues.map((venue) => {
      const week = venue.daily.slice(-7);
      return {
        id: venue.key,
        name: venue.name,
        protocol: venue.protocol,
        logo: protocolLogo(venue.protocol),
        chain: chainById(venue.network)?.name || venue.network,
        token: venue.symbol,
        apy: venue.rate,
        earned7d: week.length
          ? week.reduce((sum, point) => sum + point.rate, 0) / week.length
          : null,
        tvlUsd: venue.tvl,
        approvedFor: venue.vaults,
      };
    }),
  };
}

// One market's daily earned rate, for a chart.
export function marketHistory(key) {
  const venue = readMarketVenues().find((item) => item.key === key);
  if (!venue) return null;
  return venue.daily.map((point) => ({
    timestamp: new Date(point.at).toISOString(),
    apy: point.rate,
    tvlUsd: point.tvl,
  }));
}
