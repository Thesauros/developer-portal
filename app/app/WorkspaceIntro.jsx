"use client";
import { documentationHref, marketingHref } from "../../lib/site-links.mjs";
import { filterNetworks } from "../../lib/workspace-view.mjs";
import s from "./intro.module.css";
const drawings = {
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="15" rx="4" />
      <path d="M5 6V5a2 2 0 0 1 2-2h10v3M21 11h-5a3 3 0 0 0 0 6h5" />
      <circle cx="16" cy="14" r=".7" />
    </>
  ),
  earn: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  vaults: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="4" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 8v2m0 4v2m-4-4h2m4 0h2" />
    </>
  ),
  markets: (
    <>
      <path d="M4 20h16M6 15v-5m6 5V4m6 11V8" />
      <circle cx="6" cy="7" r=".6" />
      <circle cx="18" cy="5" r=".6" />
    </>
  ),
  activity: (
    <>
      <path d="M9 5h11M9 12h11M9 19h11" />
      <circle cx="4" cy="5" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="19" r="1" />
    </>
  ),
  build: (
    <>
      <rect x="2" y="3" width="20" height="18" rx="4" />
      <path d="M9 7H8v4l-2 1 2 1v4h1m6-10h1v4l2 1-2 1v4h-1" />
    </>
  ),
};
function Icon({ name }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {drawings[name]}
    </svg>
  );
}
export function BuildBanner() {
  return (
    <div className={s.buildBanner}>
      <div className={s.buildIcons} aria-hidden="true">
        {["wallet", "earn", "build"].map((name) => (
          <span key={name}>
            <Icon name={name} />
          </span>
        ))}
      </div>
      <p>
        Build Earn into
        <br />
        your product.
      </p>
      <a href={marketingHref("/contact?usecase=launch")}>Talk to Thesauros</a>
    </div>
  );
}
export function GettingStarted({ navigate, onGuide }) {
  return (
    <section className={s.startPanel} aria-labelledby="start-title">
      <div className={s.startHead}>
        <h2 id="start-title">Make yourself at home</h2>
        <span>Start here</span>
      </div>
      <p>From the customer experience to the infrastructure underneath.</p>
      <div className={s.startSteps}>
        <button onClick={onGuide}>
          <span className={s.stepNumber}>01</span>
          <span>
            <strong>Understand Thesauros</strong>
            <small>A quick guide to the product</small>
          </span>
          <span className={s.stepTag}>Guide</span>
        </button>
        <button onClick={() => navigate("test")}>
          <span className={s.stepNumber}>02</span>
          <span>
            <strong>Try the Earn experience</strong>
            <small>Add test funds, deposit and withdraw</small>
          </span>
          <span className={s.stepTag}>Sandbox</span>
        </button>
        <a href={documentationHref("/start/integration-paths/")}>
          <span className={s.stepNumber}>03</span>
          <span>
            <strong>Bring it into your app</strong>
            <small>Explore APIs, SDKs and integration paths</small>
          </span>
          <span className={s.stepTag}>Docs</span>
        </a>
      </div>
    </section>
  );
}
export function InfrastructureSummary({
  protocol,
  markets,
  selection,
  navigate,
}) {
  const networks = protocol.data?.networks || [];
  const vaultCount = networks.reduce((sum, n) => sum + n.vaults.length, 0);
  const marketList = filterNetworks(
    markets.data?.data || [],
    selection,
    (m) => m.chain,
  );
  const protocolCount = new Set(marketList.map((m) => m.name)).size;
  const partial =
    !!protocol.error ||
    networks.some(
      (n) => n.stale || n.status === "degraded" || !n.vaults.length,
    );
  const marketPartial = !!markets.error || !!markets.data?.stale;
  const vaultReady =
    !!protocol.data &&
    (!protocol.error || vaultCount > 0 || selection?.length === 0);
  const marketsReady =
    !!markets.data &&
    (!markets.error ||
      markets.data.data?.length > 0 ||
      selection?.length === 0);
  const cards = [
    {
      icon: "vaults",
      title: "Thesauros vaults",
      value: vaultReady ? String(vaultCount) : "—",
      detail: vaultReady
        ? `Across ${networks.filter((n) => n.vaults.length).length} observed networks`
        : protocol.loading
          ? "Waiting for protocol data"
          : "Protocol data unavailable",
      note: partial
        ? "Some data is last received or unavailable"
        : "Assets, supply rates and allocations",
      action: "Explore vaults",
      tab: "protocol",
    },
    {
      icon: "markets",
      title: "Lending markets",
      value: marketsReady ? String(marketList.length) : "—",
      detail: marketsReady
        ? `${protocolCount} external lending protocols`
        : markets.loading
          ? "Waiting for market data"
          : "Market data unavailable",
      note:
        marketPartial && marketsReady
          ? "Includes last received market data"
          : "Compare market size and variable supply rates",
      action: "Compare markets",
      tab: "markets",
    },
    {
      icon: "activity",
      title: "Onchain activity",
      value: null,
      detail: "Follow the movement of capital",
      note: "Protocol transactions, sources and CSV exports",
      action: "View activity",
      tab: "activity",
    },
  ];
  return (
    <nav className={s.capabilities} aria-label="Explore platform capabilities">
      {cards.map((card) => (
        <button
          className={s.capability}
          key={card.icon}
          onClick={() => navigate(card.tab)}
          aria-label={card.action}
        >
          <span className={s.capabilityTop}>
            <span className={s.capabilityIcon}>
              <Icon name={card.icon} />
            </span>
            <strong>{card.title}</strong>
            {card.value !== null && (
              <span className={s.capabilityValue}>{card.value}</span>
            )}
          </span>
          <span className={s.cardDetail}>{card.detail}</span>
          <span className={s.description}>{card.note}</span>
          <span className={s.cardAction}>{card.action}</span>
        </button>
      ))}
    </nav>
  );
}
export default function WorkspaceIntro({ navigate, onGuide }) {
  return (
    <section className={s.earnBanner} aria-labelledby="earn-intro-title">
      <img
        className={s.reflections}
        src="/brand/reflections-soft.webp"
        alt=""
        width="1280"
        height="720"
        fetchPriority="high"
      />
      <div className={s.bannerCopy}>
        <span className={s.eyebrow}>The infrastructure behind Earn</span>
        <h2 id="earn-intro-title">
          Stablecoin yield.
          <br />
          Built into your app.
        </h2>
        <p>
          Thesauros connects apps to onchain lending. Explore the
          infrastructure. Try the Earn experience.
        </p>
        <div className={s.bannerActions}>
          <button onClick={() => navigate("test")}>Try Earn in Sandbox</button>
          <button className={s.guideAction} onClick={onGuide}>
            How it works
          </button>
        </div>
      </div>
      <div
        className={s.flow}
        aria-label="Your app connects to a Thesauros vault, which allocates to lending markets"
      >
        <div className={s.flowApp}>
          <span className={s.flowIcon}>
            <Icon name="wallet" />
          </span>
          <div>
            <strong>Your app</strong>
            <span>Your brand. Your customer.</span>
          </div>
          <span className={s.earnPill}>Earn</span>
        </div>
        <div className={s.flowConnector} aria-hidden="true" />
        <div className={s.flowVault}>
          <img src="/brand/mark.svg" alt="" width="27" height="27" />
          <strong>Thesauros vault</strong>
          <span>Allocation & accounting</span>
        </div>
        <div className={s.flowConnector} aria-hidden="true" />
        <div className={s.flowMarkets}>
          <Icon name="markets" />
          <span>Lending markets</span>
          <span className={s.marketDots} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    </section>
  );
}
