// Every network Thesauros runs on, in one place. Vault, history, sampling and
// index code read their endpoints and labels from here, so adding a network is
// one entry rather than an edit in every module.
//
// `read` answers current-state calls from the browser and the server; `archive`
// answers calls at old blocks; `logs` answers getLogs with at most `logSpan`
// blocks per request. All are public endpoints; a keyed RPC can replace any
// list through THESAUROS_RPC_<ID> (comma-separated) without a code change.
import { arbitrum, base, mainnet, monad, plasma } from "viem/chains";

const override = (id, list) => {
  const value =
    typeof process !== "undefined"
      ? process.env?.["THESAUROS_RPC_" + id.toUpperCase()]
      : "";
  return value ? value.split(",").map((s) => s.trim()).filter(Boolean) : list;
};

const define = (entry) => ({
  ...entry,
  read: override(entry.id, entry.read),
  archive: override(entry.id, entry.archive),
  logs: override(entry.id, entry.logs),
});

export const CHAINS = Object.freeze({
  ethereum: define({
    id: "ethereum",
    name: "Ethereum",
    chainId: 1,
    chain: mainnet,
    explorer: "https://etherscan.io",
    icon: "/brand/tokens/eth.svg",
    gasToken: "ETH",
    blockSeconds: 12,
    read: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
    archive: [
      "https://rpc.mevblocker.io",
      "https://eth-mainnet.public.blastapi.io",
      "https://eth.drpc.org",
    ],
    logs: ["https://rpc.mevblocker.io", "https://eth-mainnet.public.blastapi.io"],
    logSpan: 10_000n,
    logParallel: 2,
  }),
  arbitrum: define({
    id: "arbitrum",
    name: "Arbitrum",
    chainId: 42161,
    chain: arbitrum,
    explorer: "https://arbiscan.io",
    icon: "/brand/tokens/arb.png",
    gasToken: "ETH",
    blockSeconds: 0.25,
    read: [
      "https://arbitrum-one-rpc.publicnode.com",
      "https://arb1.arbitrum.io/rpc",
    ],
    archive: [
      "https://arbitrum-one.public.blastapi.io",
      "https://arb1.arbitrum.io/rpc",
    ],
    // arb1.arbitrum.io answers at most 100,000 blocks per getLogs.
    logs: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
    logSpan: 100_000n,
    logParallel: 4,
  }),
  base: define({
    id: "base",
    name: "Base",
    chainId: 8453,
    chain: base,
    explorer: "https://basescan.org",
    icon: "/brand/tokens/base.svg",
    gasToken: "ETH",
    // 0.2 s since early November 2026, 2 s before; block searches measure the
    // real spacing, so this is only the first guess.
    blockSeconds: 0.2,
    read: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
    archive: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    logs: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    logSpan: 2_000n,
    logParallel: 6,
  }),
  monad: define({
    id: "monad",
    name: "Monad",
    chainId: 143,
    chain: monad,
    explorer: "https://monadscan.com",
    icon: "/brand/tokens/monad.png",
    gasToken: "MON",
    blockSeconds: 0.4,
    // The foundation's public endpoints take 20 calls a second from one address
    // but only 5 JSON-RPC batches (docs.monad.xyz, network information), and a
    // position read is seven batches. Here reads made together travel as one
    // contract call through Multicall3, and nothing is sent as a batch.
    groupReads: "multicall",
    read: ["https://rpc1.monad.xyz", "https://rpc.monad.xyz"],
    archive: ["https://rpc1.monad.xyz"],
    logs: ["https://rpc1.monad.xyz", "https://rpc.monad.xyz"],
    logSpan: 1_000_000n,
    logParallel: 1,
  }),
  plasma: define({
    id: "plasma",
    name: "Plasma",
    chainId: 9745,
    chain: plasma,
    explorer: "https://plasmascan.to",
    icon: "/brand/tokens/plasma.png",
    gasToken: "XPL",
    blockSeconds: 1,
    read: ["https://rpc.plasma.to"],
    archive: ["https://rpc.plasma.to"],
    logs: ["https://rpc.plasma.to"],
    logSpan: 10_000n,
    logParallel: 4,
  }),
});

export const chainList = Object.values(CHAINS);
export const chainById = (id) => CHAINS[id] || null;
export const chainByChainId = (chainId) =>
  chainList.find((c) => c.chainId === Number(chainId)) || null;
export const chainName = (id) => CHAINS[id]?.name || id;
export const chainIcon = (id) => CHAINS[id]?.icon || null;
