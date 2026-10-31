"use client";
import { Markets, useLive } from "../LivePanels";
import BrandLoading from "../../ui/BrandLoading";
import s from "./bluechips.module.css";

const usd = (value) =>
  value >= 1e9
    ? "$" + (value / 1e9).toFixed(2) + "B"
    : "$" + (value / 1e6).toFixed(1) + "M";

function Summary({ list }) {
  // DefiLlama's market TVL is what is not lent out, so it describes liquidity
  // and cannot weight a rate as if it were deposits.
  const liquidity = list.reduce((sum, p) => sum + (p.tvlUsd || 0), 0);
  const rates = list.map((p) => p.apy).sort((a, b) => a - b);
  const middle = Math.floor(rates.length / 2);
  const median =
    rates.length % 2 ? rates[middle] : (rates[middle - 1] + rates[middle]) / 2;
  const best = list.reduce((a, b) => (b.apy > a.apy ? b : a), list[0]);
  return (
    <dl className={s.tiles}>
      <div>
        <dt>Markets</dt>
        <dd>{list.length}</dd>
        <small>across {new Set(list.map((p) => p.chain)).size} networks</small>
      </div>
      <div>
        <dt>Available liquidity</dt>
        <dd>{usd(liquidity)}</dd>
        <small>supplied and not lent out</small>
      </div>
      <div>
        <dt>Median rate</dt>
        <dd>{median.toFixed(2)}%</dd>
        <small>half of these markets pay more</small>
      </div>
      <div>
        <dt>Highest rate</dt>
        <dd>{best.apy.toFixed(2)}%</dd>
        <small>
          {best.name}, {best.token} on {best.chain}
        </small>
      </div>
    </dl>
  );
}

export default function BlueChips() {
  const feed = useLive("bluechips");
  const list = feed.data?.data || [];
  const answered = feed.data != null && !feed.data.error;
  return (
    <main className={s.page}>
      <div className={s.inner}>
        <header className={s.head}>
          <a className={s.brand} href="/app">
            <img src="/brand/mark.svg" width="24" height="24" alt="" />
            Thesauros
          </a>
        </header>
        <h1>Blue chips</h1>
        <p className={s.lede}>
          Every stablecoin market on Aave V3 and Compound V3, on every network.
          These are the protocols Thesauros rates highest for risk. Rates are
          variable and include rewards where a market pays them.
        </p>
        {!list.length && feed.loading ? (
          <BrandLoading label="Loading blue-chip markets" />
        ) : !list.length && answered ? (
          <p className={s.state} role="status">
            No blue-chip market is reporting a rate right now.
          </p>
        ) : !list.length ? (
          <div className={`${s.state} ${s.failed}`} role="alert">
            <p>The market data could not load. Your funds are not affected.</p>
            <button onClick={feed.refresh}>Try again</button>
          </div>
        ) : (
          <>
            <Summary list={list} />
            <Markets feed={feed} />
            <p className={s.source}>
              Source: DefiLlama, read every 10 minutes.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
