"use client";
import { useEffect, useState } from "react";
import {
  CrosschainStatus,
  EarlyNotice,
  VaultOverview,
} from "./CrosschainPanels";
import s from "./crosschain.module.css";

async function read(resource) {
  const response = await fetch("/api/crosschain/" + resource, {
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Unavailable");
  return value;
}

// The vault for anyone with the link: no wallet, no account, nothing personal.
// Each source fails on its own, and a failed refresh keeps the last good figures
// while saying so.
export default function CrosschainLive() {
  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    async function load() {
      const [vault, allocation, prices] = await Promise.allSettled([
        read("vault"),
        read("allocation"),
        read("prices"),
      ]);
      if (!active) return;
      const fail = (result) =>
        result.status === "rejected" ? result.reason.message : "";
      setFeed((last) => ({
        vault: vault.value ?? last?.vault ?? null,
        allocation: allocation.value ?? last?.allocation ?? null,
        prices: prices.value ?? last?.prices ?? null,
        backendError: "",
        sourceErrors: {
          vault: fail(vault),
          allocation: fail(allocation),
          activity: fail(prices),
        },
      }));
      setLoading(false);
    }
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <main className={s.page}>
      <div className={`${s.workspace} ${s.pageInner}`}>
        <header className={s.pageHead}>
          <a className={s.brand} href="https://www.thesauros.io">
            <img src="/brand/mark.svg" width="24" height="24" alt="" />
            Thesauros
          </a>
          <a className={s.openApp} href="/app/individual">
            Open the app
          </a>
        </header>
        <div>
          <h1 className={s.title}>Cross-chain USDC vault</h1>
          <p className={s.lede}>
            One deposit on Base, working across Base and Arbitrum. Balances and
            the share price are read from the contracts. No wallet or account is
            needed to view it.
          </p>
          <EarlyNotice vault={feed?.vault} />
        </div>
        <CrosschainStatus feed={feed} loading={loading} />
        {feed && (
          <VaultOverview
            vault={feed.vault}
            allocation={feed.allocation}
            ticks={feed.prices?.ticks}
            now={feed.vault?.observedAt}
            explain
          />
        )}
      </div>
    </main>
  );
}
