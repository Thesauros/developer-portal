"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useDisconnect } from "wagmi";
import { documentationHref, marketingHref } from "../../lib/site-links.mjs";
import { workspaceDestination } from "./destination.mjs";
import { useLive, Markets } from "./LivePanels";
import NetworkFilter from "./NetworkFilter";
import { crosschainAccountViews } from "../../lib/crosschain-feed.mjs";
import InstitutionSettings from "./cabinet/InstitutionSettings";
import BrandLoading from "../ui/BrandLoading";
import s from "./workspace.module.css";
const loading = () => <BrandLoading />;
const TestAccount = dynamic(() => import("./TestAccount"), { loading });
const AccountSettings = dynamic(() => import("./AccountSettings"), { loading });
const QuickGuide = dynamic(() => import("./QuickGuide"));
const PlatformGuide = dynamic(() => import("./PlatformGuide"));
const DeveloperCenter = dynamic(() => import("./DeveloperCenter"), { loading });
const CrosschainWorkspace = dynamic(() => import("./CrosschainWorkspace"), {
  loading,
});
const labels = {
  crosschain: "Cross-chain",
  overview: "Portfolio",
  vaults: "Vaults",
  activity: "Activity",
  earn: "Deposit & withdraw",
  markets: "Market rates",
  test: "Sandbox",
  developers: "Developers",
  settings: "Account",
};
const descriptions = {
  crosschain: "USDC across Base and Arbitrum, with epoch settlement on Base.",
  vaults:
    "The cross-chain USDC vault, its accepted NAV and allocation across Base and Arbitrum.",
  activity:
    "Your cross-chain requests, claims and cancellations, indexed from EpochVault events.",
  earn: "Request deposits and withdrawals on Base, then claim after epoch settlement.",
  markets: "Stablecoin lending rates across DeFi, for comparison.",
  test: "Practise with simulated USDC. Nothing moves onchain.",
};

const icons = {
  crosschain: (
    <>
      <circle cx="6" cy="7" r="3" />
      <circle cx="18" cy="17" r="3" />
      <path d="M9 7h8v7M15 17H7v-7" />
    </>
  ),
  overview: (
    <>
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="3" y="15" width="7" height="6" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
    </>
  ),
  vaults: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 8v8m-4-4h8" />
    </>
  ),
  earn: (
    <>
      <rect x="3" y="5" width="18" height="15" rx="3" />
      <path d="M3 8h18M15 12h6v5h-6a2.5 2.5 0 0 1 0-5Z" />
      <circle cx="16" cy="14.5" r=".6" />
    </>
  ),
  markets: <path d="M4 20V5m0 15h17M8 16v-5m5 5V5m5 11V9" />,
  activity: (
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="3" cy="6" r=".8" />
      <circle cx="3" cy="12" r=".8" />
      <circle cx="3" cy="18" r=".8" />
    </>
  ),
  developers: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M17.5 14v7M14 17.5h7" />
    </>
  ),
  test: (
    <path d="M9 3h6m-5 0v6l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3M8 14h8" />
  ),
  settings: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 6 0 0 1 16 0v2" />
    </>
  ),
};
export default function ProductApp({ mode = "individual", user }) {
  const { disconnectAsync } = useDisconnect();
  const [tab, setTab] = useState("overview"),
    [menu, setMenu] = useState(false);
  const [selection, setSelection] = useState(null);
  // The guide opens on request only; the workspace explains itself.
  const [guide, setGuide] = useState(null);
  function closeGuide() {
    setGuide(null);
  }
  const guideOpener = useRef(null);
  function openGuide(event) {
    guideOpener.current = event?.currentTarget || document.activeElement;
    setGuide("platform");
  }
  const [signingOut, setSigningOut] = useState(false),
    [error, setError] = useState("");
  const sidebar = useRef(null),
    menuButton = useRef(null),
    heading = useRef(null);
  const markets = useLive("markets", tab === "markets");
  const networkOptions = [
    ...new Set((markets.data?.data || []).map((m) => m.chain)),
  ].sort();
  const current = tab.split("/")[0];
  const dataPage = current === "markets";
  const institution = user.kind === "institution";
  const displayName = institution
    ? user.company || user.email
    : user.walletAddress
      ? `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}`
      : user.name;
  function navigate(id) {
    if (id === "build") id = "developers";
    if (!labels[id]) return;
    if (id !== tab) history.pushState(null, "", "#" + id);
    setTab(id);
    setMenu(false);
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() =>
      heading.current?.focus({ preventScroll: true }),
    );
  }
  useEffect(() => {
    const sync = () => {
      const id =
        workspaceDestination(mode, { hash: location.hash }).split("#")[1] ||
        "overview";
      setTab(labels[id] ? id : "overview");
      setMenu(false);
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [mode]);
  useEffect(() => {
    if (!menu) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () => [
      ...sidebar.current.querySelectorAll("a[href], button:not([disabled])"),
    ];
    controls()[0]?.focus();
    const keys = (event) => {
      if (event.key === "Escape") {
        setMenu(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = controls(),
        first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const resized = () => {
      if (window.innerWidth > 900) setMenu(false);
    };
    window.addEventListener("keydown", keys);
    window.addEventListener("resize", resized);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", keys);
      window.removeEventListener("resize", resized);
      menuButton.current?.focus();
    };
  }, [menu]);
  async function signOut() {
    setSigningOut(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error();
      try {
        sessionStorage.removeItem("thesauros.integration." + user.id);
      } catch {}
      window.dispatchEvent(new Event("thesauros:navigating"));
      await disconnectAsync().catch(() => {});
      location.assign("/app/" + mode);
    } catch {
      setError("Could not sign out. Try again.");
      setSigningOut(false);
    }
  }
  function refresh() {
    markets.refresh();
  }
  const refreshing = markets.loading;
  const toolbar = (
    <div className={s.toolbar}>
      <NetworkFilter
        options={networkOptions}
        value={selection}
        onChange={setSelection}
      />
      <button
        className={s.secondaryButton}
        onClick={refresh}
        disabled={refreshing}
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
  function navigationButton(id, compact = false) {
    return (
      <button
        key={id}
        onClick={() => navigate(id)}
        aria-current={current === id ? "page" : undefined}
      >
        <svg
          className={s.navGlyph}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {icons[id]}
        </svg>
        <span>{compact && id === "earn" ? "Move" : labels[id]}</span>
        {id === "test" && <span className={s.navBadge}>Test</span>}
      </button>
    );
  }
  return (
    <div className={s.shell}>
      <a
        className={s.skip}
        href="#account-main"
        onClick={(event) => {
          event.preventDefault();
          heading.current?.focus();
        }}
      >
        Skip to workspace
      </a>
      <header className={s.header} inert={menu || undefined}>
        <a className={s.brand} href={marketingHref("/")}>
          <img src="/brand/mark.svg" width="27" height="27" alt="" />
          Thesauros
        </a>
        <nav aria-label="Help and account">
          {mode === "institution" && (
            <span className={s.modeTag}>Institution</span>
          )}
          <a href={documentationHref("/")}>Docs</a>
          <button
            className={s.accountButton}
            onClick={() => navigate("settings")}
            aria-label="Account settings"
          >
            {displayName}
          </button>
          <button
            ref={menuButton}
            className={s.menuButton}
            onClick={() => setMenu(!menu)}
            aria-expanded={menu}
            aria-controls="account-navigation"
          >
            Menu
          </button>
        </nav>
      </header>
      <div className={s.layout}>
        <aside
          ref={sidebar}
          id="account-navigation"
          className={`${s.sidebar} ${menu ? s.sidebarOpen : ""}`}
          role={menu ? "dialog" : undefined}
          aria-modal={menu || undefined}
          aria-label={menu ? "Workspace navigation" : undefined}
        >
          <button className={s.mobileClose} onClick={() => setMenu(false)}>
            Close navigation
          </button>
          <nav aria-label="Account navigation">
            <div className={s.navGroup}>
              {["overview", "vaults", "activity", "earn"].map((id) =>
                navigationButton(id),
              )}
            </div>
            <div className={s.navGroup}>
              <span className={s.navGroupLabel}>Tools</span>
              {["markets", "test", "developers", "settings"].map((id) =>
                navigationButton(id),
              )}
            </div>
          </nav>
          <div className={s.sidebarBottom}>
            <button onClick={openGuide}>How Earn works</button>
            <a href={marketingHref("/contact")}>Contact support</a>
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
            tabIndex={-1}
          />
        )}
        <main id="account-main" className={s.main} inert={menu || undefined}>
          <div className={s.heading}>
            <div>
              <h1 ref={heading} tabIndex={-1}>
                {current === "overview" && mode === "institution"
                  ? "Treasury"
                  : labels[current]}
              </h1>
              {descriptions[current] && <p>{descriptions[current]}</p>}
            </div>
            {dataPage && toolbar}
          </div>
          {error && (
            <p className={s.warning} role="alert">
              {error}
            </p>
          )}
          {dataPage && selection?.length === 0 && (
            <div className={s.selectionNotice}>
              No networks selected.
              <button
                className={s.textButton}
                onClick={() => setSelection(null)}
              >
                Show all networks
              </button>
            </div>
          )}
          {crosschainAccountViews.includes(current) && (
            <CrosschainWorkspace
              user={user}
              view={current}
              navigate={navigate}
            />
          )}
          {current === "markets" && (
            <Markets feed={markets} networks={selection} />
          )}
          {current === "developers" && (
            <DeveloperCenter user={user} navigate={navigate} />
          )}
          {current === "test" && (
            <TestAccount mode="individual" navigate={navigate} />
          )}
          {current === "settings" &&
            (institution ? (
              <InstitutionSettings
                user={user}
                signOut={signOut}
                signingOut={signingOut}
              />
            ) : (
              <AccountSettings
                user={user}
                signOut={signOut}
                signingOut={signingOut}
              />
            ))}
          <footer className={s.footer}>
            <span>Thesauros</span>
            <a href={documentationHref("/security/controls/")}>Security</a>
            <a href={documentationHref("/")}>Documentation</a>
          </footer>
        </main>
      </div>
      <nav
        className={s.mobileDock}
        aria-label="Quick navigation"
        inert={menu || undefined}
      >
        {["overview", "vaults", "activity", "earn"].map((id) =>
          navigationButton(id, true),
        )}
      </nav>
      {guide === "platform" && (
        <PlatformGuide
          onClose={closeGuide}
          navigate={navigate}
          returnFocusRef={guideOpener}
        />
      )}
      {guide === "earn" && (
        <QuickGuide
          open={true}
          onClose={closeGuide}
          navigate={(id) => navigate(id === "overview" ? "earn" : id)}
          returnFocusRef={guideOpener}
        />
      )}
    </div>
  );
}
