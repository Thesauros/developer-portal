"use client";
import { Tier, VaultMark } from "./Portfolio";
import { pct } from "./format";
import c from "./cabinet.module.css";

// The lending markets Thesauros vaults allocate to right now, with the rate
// each vault reads from its provider contract. Listed separately because the
// market table below comes from DefiLlama, which does not track every
// curated vault (Steakhouse on Arbitrum, for example).
export default function OurMarkets({ market }) {
  const rows = (market.data?.vaults || []).flatMap((v) =>
    (v.providers || [])
      .filter((p) => (p.share ?? 0) > 0)
      .map((p) => ({ ...p, vault: v })),
  );
  if (!rows.length && market.loading)
    return <p className={c.emptyLine}>Loading the markets Thesauros uses…</p>;
  if (!rows.length) return null;
  rows.sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0));
  return (
    <section className={c.section} style={{ marginBottom: 28 }}>
      <header className={c.sectionHead}>
        <div>
          <h2>Markets Thesauros lends to</h2>
          <p className={c.muted}>
            Current allocation of the four vaults, with rates read from the
            provider contracts. The table below compares the wider market.
          </p>
        </div>
      </header>
      <div className={c.tableWrap}>
        <table className={c.table}>
          <thead>
            <tr>
              <th>Lending market</th>
              <th>Network</th>
              <th>Risk tier</th>
              <th className={c.num}>Rate</th>
              <th className={c.num}>Share of vault</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.vault.id + p.address}>
                <td>
                  {p.logo && (
                    <img
                      src={"/brand/protocols/" + p.logo + ".png"}
                      width="20"
                      height="20"
                      alt=""
                      className={c.logo}
                    />
                  )}
                  {p.name}
                </td>
                <td>
                  <span className={c.netCell}>
                    <VaultMark vault={p.vault} size={16} />
                    {p.vault.network}
                  </span>
                </td>
                <td>
                  <Tier tier={p.riskTier} />
                </td>
                <td className={c.num}>{pct(p.apy)}</td>
                <td className={c.num}>
                  {p.share < 0.1 ? "<0.1%" : p.share.toFixed(1) + "%"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
