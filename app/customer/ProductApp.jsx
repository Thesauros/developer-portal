"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  base,
  useLive,
  Protocol,
  Markets,
  Events,
  fmt,
  compact,
  Mark,
} from "./LivePanels";
import WalletCard from "./WalletCard";
import BrandLoading from "../ui/BrandLoading";
const loading = () => <BrandLoading />;
const DeveloperTools = dynamic(() => import("./DeveloperTools"), { loading });
const TestAccount = dynamic(() => import("./TestAccount"), { loading });
const AccountSettings = dynamic(() => import("./AccountSettings"), { loading });
import s from "./workspace.module.css";
const labels = {
  overview: "Overview",
  protocol: "Vaults & providers",
  markets: "Markets",
  activity: "Onchain activity",
  customers: "Customers",
  integrations: "Developers",
  test: "Test account",
  settings: "Account",
};
export default function ProductApp({ mode, user }) {
  const institution = mode === "institution";
  const [tab, setTab] = useState("overview"),
    [menu, setMenu] = useState(false),
    [signingOut, setSigningOut] = useState(false),
    [error, setError] = useState("");
  const protocol = useLive("protocol"),
    markets = useLive("markets");
  const nav = [
    "overview",
    "protocol",
    "markets",
    "activity",
    ...(institution ? ["customers", "integrations"] : []),
    "test",
    "settings",
  ];
  const current = tab.split("/")[0];
  const awaitingProtocol = !protocol.data && protocol.loading;
  const awaitingMarkets = !markets.data && markets.loading;
  const awaitingContent =
    current === "overview"
      ? awaitingProtocol && awaitingMarkets
      : current === "protocol" || current === "activity"
        ? awaitingProtocol
        : current === "markets"
          ? awaitingMarkets
          : false;
  function navigate(id) {
    if (!nav.includes(id.split("/")[0])) return;
    setTab(id);
    setMenu(false);
    history.pushState(null, "", "#" + id);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  useEffect(() => {
    function sync() {
      const id = location.hash.slice(1);
      if (nav.includes(id.split("/")[0])) setTab(id);
      else setTab("overview");
    }
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    const escape = (e) => {
      if (e.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
      window.removeEventListener("keydown", escape);
    };
  }, [mode]);
  async function signOut() {
    setSigningOut(true);
    try {
      const r = await fetch(base + "/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) throw new Error();
      try {
        sessionStorage.removeItem("thesauros.integration." + user.id);
      } catch {}
      window.dispatchEvent(new Event("thesauros:navigating"));
      location.assign("/app/?mode=" + mode);
    } catch {
      setError("Sign out could not complete. Please retry.");
      setSigningOut(false);
    }
  }
  const networks = protocol.data?.networks || [],
    vaults = networks.flatMap((n) => n.vaults),
    reporting = vaults.filter((v) => v.assets !== null);
  const usdc = reporting
      .filter((v) => v.token === "USDC")
      .reduce((n, v) => n + v.assets, 0),
    usdt = reporting
      .filter((v) => v.token === "USDT0")
      .reduce((n, v) => n + v.assets, 0);
  const titles = {
    overview: institution
      ? "Capital. With perspective."
      : "Your next move starts here.",
    protocol: "Know what sits underneath.",
    markets: "See the wider market.",
    activity: "A record you can follow.",
    customers: "Earn, inside their account.",
    integrations: "Build the connection.",
    test: institution
      ? "Try your treasury flow."
      : "Try your first Earn deposit.",
    settings: "Your account, considered.",
  };
  function exportProtocol() {
    const rows = [
      ["Thesauros protocol report", "Token amounts, not USD valuations"],
      ["Network", "Vault", "Asset", "Assets", "APY percent", "Observation UTC"],
      ...networks.flatMap((n) =>
        n.vaults.map((v) => [
          n.name,
          v.address,
          v.token,
          v.assets ?? "",
          v.apy ?? "",
          n.observedAt || "",
        ]),
      ),
      [],
      ["Network", "Event", "Transaction", "Block", "Time UTC"],
      ...networks.flatMap((n) =>
        n.events.map((e) => [
          n.name,
          e.type,
          e.txHash,
          e.blockNumber,
          e.timestamp,
        ]),
      ),
    ];
    const url = URL.createObjectURL(
      new Blob(
        [
          rows
            .map((r) =>
              r
                .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
                .join(","),
            )
            .join("\n"),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "thesauros-protocol-report.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className={s.shell}>
      <a className={s.skip} href="#account-main">
        Skip to workspace
      </a>
      <header className={s.header}>
        <a className={s.brand} href="/">
          <img src={base + "/brand/mark.svg"} width="26" height="26" alt="" />
          Thesauros
        </a>
        <span className={s.headerMode}>
          {institution ? "Institution" : "Individual"}
        </span>
        <nav>
          <a href="/docs/">Documentation</a>
          <a href="/contact">Support</a>
          <button
            className={s.accountButton}
            onClick={() => navigate("settings")}
            aria-label="Account settings"
          >
            {user.name
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")}
          </button>
          <button
            className={s.menuButton}
            onClick={() => setMenu(!menu)}
            aria-expanded={menu}
            aria-controls="account-navigation"
          >
            {menu ? "Close" : "Menu"}
          </button>
        </nav>
      </header>
      <div className={s.layout}>
        <aside
          id="account-navigation"
          className={s.sidebar + " " + (menu ? s.sidebarOpen : "")}
        >
          <div className={s.workspaceName}>
            <span className={s.eyebrow}>
              {institution ? "Business workspace" : "Personal workspace"}
            </span>
            <strong>{institution ? user.company : user.name}</strong>
          </div>
          <nav aria-label="Account navigation">
            {nav.map((id) => (
              <button
                key={id}
                onClick={() => navigate(id)}
                aria-current={current === id ? "page" : undefined}
              >
                <span className={s.navGlyph} aria-hidden="true">
                  {
                    {
                      overview: "◫",
                      protocol: "▤",
                      markets: "◉",
                      activity: "≋",
                      customers: "◌",
                      integrations: "{}",
                      test: "◈",
                      settings: "⚙",
                    }[id]
                  }
                </span>
                {labels[id]}
              </button>
            ))}
          </nav>
          <div className={s.sidebarBottom}>
            <div className={s.sidebarCard}>
              <div className={s.sidebarIllustration} aria-hidden="true">
                <span className={s.sidebarWalletIcon}>
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect
                      x="4"
                      y="6"
                      width="16"
                      height="13"
                      rx="4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M5 7V6a2 2 0 0 1 2-2h10"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M16 11h4v5h-4a2.5 2.5 0 0 1 0-5Z"
                      fill="currentColor"
                      opacity=".25"
                    />
                    <circle cx="16" cy="13.5" r="1" fill="currentColor" />
                  </svg>
                </span>
                <span className={s.sidebarEarnIcon}>
                  <svg viewBox="0 0 24 24" fill="none">
                    <ellipse
                      cx="12"
                      cy="7"
                      rx="7"
                      ry="3"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                  </svg>
                </span>
                <span className={s.sidebarBuildIcon}>
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect
                      x="4"
                      y="4"
                      width="16"
                      height="16"
                      rx="4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M10 8H9v3l-1 1 1 1v3h1m4-8h1v3l1 1-1 1v3h-1"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
              <span>
                From possibility
                <br />
                to your product.
              </span>
              <a href="/contact">Talk to Thesauros</a>
            </div>
            <button onClick={signOut} disabled={signingOut}>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </aside>
        {menu && (
          <button
            className={s.backdrop}
            onClick={() => setMenu(false)}
            aria-label="Close navigation"
          />
        )}
        <main id="account-main" className={s.main}>
          <div className={s.breadcrumb}>
            <span>
              {institution ? "Institution" : "Individual"} / {labels[current]}
            </span>
            <span>Thesauros workspace</span>
          </div>
          <div className={s.heading}>
            <div>
              <span className={s.eyebrow}>
                {current === "overview"
                  ? "A clearer view of capital"
                  : labels[current]}
              </span>
              <h1>{titles[current]}</h1>
              <p>
                {current === "overview"
                  ? institution
                    ? "Follow the protocol, understand the markets and build your Earn experience."
                    : "Explore Earn, read your wallet and follow the markets underneath."
                  : current === "protocol"
                    ? "Onchain vault data from the Thesauros monitoring service."
                    : current === "markets"
                      ? "Supply rates and liquidity across independent lending markets."
                      : current === "activity"
                        ? "Indexed events across the Thesauros vaults."
                        : current === "test"
                          ? "A persistent test account, ready to explore with simulated USDC."
                          : ""}
              </p>
            </div>
            {institution &&
              ["overview", "protocol", "activity"].includes(current) && (
                <button
                  className={s.secondaryButton}
                  onClick={exportProtocol}
                  disabled={!networks.length}
                >
                  Export report
                </button>
              )}
          </div>
          {error && (
            <p className={s.warning} role="alert">
              {error}
            </p>
          )}
          <BrandLoading
            pending={awaitingContent}
            key={current}
            label="Preparing your workspace"
          >
            {current === "overview" && (
              <>
                <section className={s.summaryStats}>
                  <div>
                    <span>Thesauros vaults</span>
                    <strong>
                      {networks.length ? vaults.length : "—"}
                      <small> / {networks.length || "—"} networks</small>
                    </strong>
                    <p>
                      {networks.length
                        ? reporting.length + " with current asset data"
                        : "Connecting to the protocol"}
                    </p>
                  </div>
                  <div>
                    <span>Observed vault assets · USDC</span>
                    <strong>
                      {reporting.some((v) => v.token === "USDC")
                        ? fmt(usdc, 4)
                        : "—"}
                    </strong>
                    <p>
                      {reporting.filter((v) => v.token === "USDC").length}{" "}
                      reporting USDC vaults
                    </p>
                  </div>
                  <div>
                    <span>Observed vault assets · USDT0</span>
                    <strong>
                      {reporting.some((v) => v.token === "USDT0")
                        ? fmt(usdt, 4)
                        : "—"}
                    </strong>
                    <p>Amounts in underlying tokens</p>
                  </div>
                  <div>
                    <span>Markets followed</span>
                    <strong>{markets.data?.data?.length || "—"}</strong>
                    <p>A separate view of lending liquidity</p>
                  </div>
                </section>
                <div className={s.overviewGrid}>
                  <div>
                    {institution ? (
                      <section
                        className={s.businessHero}
                        style={{
                          backgroundImage:
                            "linear-gradient(90deg,#122e48ed,#122e4830),url(" +
                            base +
                            "/brand/login-gallery.webp)",
                        }}
                      >
                        <span className={s.eyebrow}>
                          Your business. Your interface.
                        </span>
                        <h2>
                          Put the infrastructure
                          <br />
                          to work for you.
                        </h2>
                        <p>
                          Start with a test deposit or bring your developers
                          into the same workspace.
                        </p>
                        <div className={s.buttonRow}>
                          <button onClick={() => navigate("test")}>
                            Try a deposit
                          </button>
                          <button onClick={() => navigate("integrations")}>
                            Start building
                          </button>
                        </div>
                      </section>
                    ) : (
                      <WalletCard networks={networks} />
                    )}
                    <Protocol
                      feed={protocol}
                      brief
                      onExplore={() => navigate("protocol")}
                    />
                  </div>
                  <div>
                    <Markets
                      feed={markets}
                      brief
                      onExplore={() => navigate("markets")}
                    />
                    {!institution && (
                      <section className={s.smallCta}>
                        <div>
                          <span className={s.eyebrow}>Experience Earn</span>
                          <h3>
                            A small move.
                            <br />A little more possibility.
                          </h3>
                          <p>
                            Explore deposits and withdrawals with test USDC.
                          </p>
                        </div>
                        <button
                          className={s.secondaryButton}
                          onClick={() => navigate("test")}
                        >
                          Try a test deposit
                        </button>
                      </section>
                    )}
                  </div>
                </div>
              </>
            )}
            {current === "protocol" && <Protocol feed={protocol} />}
            {current === "markets" && <Markets feed={markets} />}
            {current === "activity" && <Events networks={networks} />}
            {current === "test" && <TestAccount mode={mode} />}
            {current === "settings" && (
              <AccountSettings user={user} mode={mode} />
            )}
            {current === "integrations" && institution && (
              <DeveloperTools
                view={tab.split("/")[1] || "quickstart"}
                navigate={navigate}
                userId={user.id}
              />
            )}
            {current === "customers" && institution && (
              <section className={s.panel}>
                <span className={s.eyebrow}>Customer Earn</span>
                <h2>Ready for your first connection.</h2>
                <div className={s.customerEmpty}>
                  <div className={s.customerCircles}>
                    <span />
                    <span />
                    <span />
                  </div>
                  <h3>No customer integration connected</h3>
                  <p>
                    Your customer balances and Earn activity will appear here
                    once a partner integration is connected to this workspace.
                  </p>
                  <button
                    className={s.primaryButton}
                    onClick={() => navigate("integrations/users")}
                  >
                    Explore test customers
                  </button>
                  <a href="/contact">Connect a partner integration</a>
                </div>
              </section>
            )}
          </BrandLoading>
          <footer className={s.footer}>
            <span>
              Thesauros · {institution ? "Institution" : "Individual"}
            </span>
            <a href="/docs/security/controls/">Security & controls</a>
            <a href="/docs/">Documentation</a>
          </footer>
        </main>
      </div>
    </div>
  );
}
