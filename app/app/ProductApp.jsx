"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useAccount, useDisconnect } from "wagmi";
import { documentationHref, marketingHref } from "../../lib/site-links.mjs";
import { workspaceDestination } from "./destination.mjs";
import useEarnAccount from "./useEarnAccount";
import useInsights from "./book/useInsights";
import InstitutionSettings from "./book/InstitutionSettings";
import BrandLoading from "../ui/BrandLoading";
import { buildBook, PRODUCT } from "../../lib/vault-book.mjs";
import { crosschain } from "../../lib/crosschain-config.mjs";
import { migrationDestination } from "../../lib/migration-destination.mjs";
import useBatchVault from "./book/useBatchVault";
import useMigrationAccount from "./useMigrationAccount";
import { usePublicResource } from "./book/parts";
import { ConnectAction } from "./wallet/WalletAccess";
import PortfolioPage from "./book/PortfolioPage";
import VaultPage from "./book/VaultPage";
import ActivityPage from "./book/ActivityPage";
import TransparencyPage from "./book/TransparencyPage";
import IndexPage from "./book/IndexPage";
import MoveNotice, { moveSummary } from "./move/MoveNotice";
import { useKept } from "./move/kept";
import { vaultGuide } from "./vault-guide";
import shell from "./workspace.module.css";
import b from "./book/book.module.css";

const loading = () => <BrandLoading />;
const AccountSettings = dynamic(() => import("./AccountSettings"), { loading });
const QuickGuide = dynamic(() => import("./QuickGuide"));
const DeveloperCenter = dynamic(() => import("./DeveloperCenter"), { loading });

const MoveApp = dynamic(() => import("./move/MoveApp"), { loading });

// Deposits follow the contract: open unless it is paused. A deployment can
// still close them here, for example while the contracts are being changed.
// Withdrawing, collecting and cancelling always work.
const depositsOpen = process.env.NEXT_PUBLIC_THESAUROS_DEPOSITS !== "closed";

// The sidebar on a desktop, the dock on a phone. Same sections, same order.
const MAIN = ["overview", "earn", "activity", "transparency"];
const TOOLS = ["index", "developers"];
const LABELS = {
  overview: "Portfolio",
  earn: "Earn",
  activity: "Activity",
  transparency: "Transparency",
  index: "Market Average",
  developers: "Developers",
  settings: "Account",
  move: "Move to the new vault",
};
const PATHS = {
  overview: "",
  earn: "/earn",
  index: "/market-average",
  activity: "/activity",
  transparency: "/transparency",
  developers: "/developers",
  settings: "/account",
  move: "/move",
};
// Where an old link or a section name leads now.
const LEGACY = {
  vaults: "earn",
  vault: "earn",
  single: "earn",
  crosschain: "earn",
  markets: "index",
  bluechips: "index",
};
const ICONS = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="3" y="15" width="7" height="6" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
    </>
  ),
  earn: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 8v8m-4-4h8" />
    </>
  ),
  activity: (
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="3" cy="6" r=".8" />
      <circle cx="3" cy="12" r=".8" />
      <circle cx="3" cy="18" r=".8" />
    </>
  ),
  transparency: (
    <>
      <path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6l7-3Z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  index: <path d="M4 20h16M5 16l4-5 4 3 6-8" />,
  developers: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M17.5 14v7M14 17.5h7" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 6 0 0 1 16 0v2" />
    </>
  ),
};
const Glyph = ({ id }) => (
  <svg
    className={b.navGlyph}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {ICONS[id]}
  </svg>
);
function parseRoute(pathname, mode) {
  const prefix = "/app/" + mode;
  const parts = pathname.startsWith(prefix)
    ? pathname.slice(prefix.length).split("/").filter(Boolean)
    : [];
  if (!parts.length) return { view: "overview" };
  if (parts[0] === "earn") return { view: "earn" };
  // Addresses from before there was one product: each opens it.
  if (parts[0] === "vaults") {
    if (parts[1] === "markets") return { view: "index" };
    return { view: "earn", stale: true };
  }
  // The Market Average; its old address still opens it.
  if (parts[0] === "market-average" || parts[0] === "blue-chip-index") return { view: "index" };
  if (parts[0] === "account") return { view: "settings" };
  if (["activity", "transparency", "developers", "move"].includes(parts[0]))
    return { view: parts[0] };
  return { view: "overview" };
}

function AccountMenu({ label, items, icon = false }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && box.current?.contains(event.target))
        return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className={b.account} ref={box}>
      <button
        className={icon ? b.menuIcon : b.accountButton}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={icon ? label : undefined}
        onClick={() => setOpen(!open)}
      >
        {icon ? (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          label
        )}
      </button>
      {open && (
        <div className={b.accountMenu} role="menu" onClick={() => setOpen(false)}>
          {items}
        </div>
      )}
    </div>
  );
}

export default function ProductApp({ mode = "individual", user }) {
  const institution = user?.kind === "institution";
  const { disconnectAsync } = useDisconnect();
  const owner = user?.walletAddress;
  const account = useEarnAccount(owner);
  // The move from a previous vault is read and signed by the wallet connected
  // in the browser. It runs only when that is the wallet of this account;
  // otherwise positions still show, from the account's own reads, and the move
  // asks for that wallet to be connected.
  const connected = useAccount();
  const walletHere =
    !!owner &&
    connected.status === "connected" &&
    connected.address?.toLowerCase() === owner.toLowerCase();
  const kept = useKept(owner);
  const migration = useMigrationAccount(walletHere ? migrationDestination : null, { kept });
  const batch = useBatchVault(user, true, migration);
  const market = useInsights("market", "30d", true);
  const mine = useInsights("account", "", !!owner);
  const history = usePublicResource("/api/vaults/history", {
    refreshMs: 300000,
  });
  const [route, setRoute] = useState({ view: user ? "overview" : "earn" });
  const [intent, setIntent] = useState(null);
  const [guide, setGuide] = useState(false);
  const guideOpener = useRef(null);
  const [signingOut, setSigningOut] = useState(false),
    [error, setError] = useState("");
  const mainRef = useRef(null);

  // A confirmed transaction refreshes vault figures and history straight away.
  const confirmedCount = (account.transactions || []).filter(
    (tx) => tx.status === "success",
  ).length;
  const seenConfirmed = useRef(null);
  useEffect(() => {
    if (seenConfirmed.current === null) {
      seenConfirmed.current = confirmedCount;
      return;
    }
    if (confirmedCount > seenConfirmed.current) {
      market.refresh();
      if (owner) mine.refresh(true);
    }
    seenConfirmed.current = confirmedCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedCount]);

  const book = useMemo(
    () =>
      buildBook({
        market: market.data,
        chainRows: account.vaults,
        mine: mine.data,
        samples: history.data?.samples || {},
        ticks: history.data?.ticks || [],
        batch: batch.feed,
        index: history.data?.index || null,
        indexes: history.data?.indexes || null,
        markets: history.data?.markets || null,
        networkIndexes: history.data?.networkIndexes || null,
        depositsOpen,
      }),
    [market.data, account.vaults, mine.data, history.data, batch.feed],
  );
  const move = useMemo(
    () => moveSummary(migration, book.account.previous),
    [migration, book.account.previous],
  );

  function navigate(view, id, options) {
    const target = LEGACY[view] || view;
    const path = PATHS[target];
    if (path === undefined) return;
    setIntent(
      target === "earn" && options?.action
        ? { action: options.action, at: Date.now() }
        : null,
    );
    history_push("/app/" + mode + path);
    setRoute({ view: target });
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() =>
      mainRef.current?.querySelector("h1")?.focus({ preventScroll: true }),
    );
  }
  function history_push(path) {
    if (location.pathname + location.search !== path)
      window.history.pushState(null, "", path);
  }
  useEffect(() => {
    const sync = () => {
      // Links from before the app had real addresses still work.
      const hash = location.hash.replace(/^#/, "");
      if (
        hash &&
        !document.getElementById(hash) &&
        /^[a-z/]+$/.test(hash) &&
        location.pathname === "/app/" + mode
      ) {
        const id =
          workspaceDestination(mode, { hash: location.hash }).split("#")[1] ||
          "overview";
        const target = LEGACY[id] || id;
        if (PATHS[target] !== undefined) {
          window.history.replaceState(
            null,
            "",
            "/app/" + mode + PATHS[target],
          );
        }
      }
      const parsed = parseRoute(location.pathname, mode);
      // An old vault address becomes the product's own.
      if (parsed.stale)
        window.history.replaceState(null, "", "/app/" + mode + PATHS.earn);
      setRoute(
        !user && parsed.view === "overview" && location.pathname === "/app/" + mode
          ? { view: "earn" }
          : { view: parsed.view },
      );
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, [mode, user]);

  const displayName = institution
    ? user.company || user.email
    : owner
      ? `${owner.slice(0, 6)}…${owner.slice(-4)}`
      : null;
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
  function openGuide(event) {
    guideOpener.current = event?.currentTarget || document.activeElement;
    setGuide(true);
  }
  const section = route.view;
  // Activity is a wallet's own history; without one, the public record is in
  // Transparency and the menu does not offer an empty page.
  const signedIn = !!user?.walletAddress;
  // A guest has no portfolio: Earn is their first page, at the app's address.
  const main = signedIn
    ? MAIN
    : MAIN.filter((id) => id !== "activity" && (user || id !== "overview"));
  const dock = signedIn ? MAIN : [...main, "index"];
  const wallet = book.account.wallet;
  // The browser tab names the page, as the server does on a fresh load.
  useEffect(() => {
    const page =
      route.view === "overview" && institution
        ? "Treasury"
        : route.view === "overview" && !user
          ? "Earn"
          : LABELS[route.view];
    document.title = "Thesauros · " + (page || "Earn");
  }, [route.view, institution, user]);
  const label = (id) =>
    id === "overview" && institution ? "Treasury" : LABELS[id];
  // Real links: they can be opened in a new tab, copied and reloaded; a plain
  // click stays in the app.
  const nav = (id, compact = false) => (
    <a
      key={id}
      href={"/app/" + mode + PATHS[id]}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(id);
      }}
      aria-current={section === id ? "page" : undefined}
      data-nav={id}
    >
      <Glyph id={id} />
      <span>{compact && id === "index" ? "Market avg" : label(id)}</span>
    </a>
  );
  const menuItems = (
    <>
      {/* What the dock already shows is not repeated here. */}
      {[...TOOLS, "settings"].filter((id) => !dock.includes(id)).map((id) => (
        <button key={id} role="menuitem" onClick={() => navigate(id)}>
          {label(id)}
        </button>
      ))}
      <button role="menuitem" onClick={openGuide}>
        How it works
      </button>
      <a role="menuitem" href={marketingHref("/contact")}>
        Contact support
      </a>
      {user ? (
        <button role="menuitem" onClick={signOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      ) : (
        <a role="menuitem" href="/app/institution">
          Institution sign in
        </a>
      )}
    </>
  );
  // Moving from a previous vault is its own small app: one job, no menu.
  if (route.view === "move")
    return (
      <MoveApp
        mode={mode}
        user={user}
        book={book}
        migration={migration}
        walletHere={walletHere}
        kept={kept}
        account={account}
        batch={batch}
        displayName={displayName}
        onBack={() => navigate(user ? "overview" : "earn")}
        onOpen={(view, options) => navigate(view, null, options)}
      />
    );
  return (
    <div
      className={`${shell.shell} ${b.app} ${route.view === "earn" ? b.onVault : ""}`}
    >
      <a
        className={b.skip}
        href="#account-main"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.querySelector("h1")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className={b.top}>
        <a className={b.brand} href={marketingHref("/")}>
          <img src="/brand/mark.svg" width="26" height="26" alt="" />
          Thesauros
        </a>
        <div className={b.topRight}>
          {institution && <span className={b.modeTag}>Institution</span>}
          <a className={b.topLink} href={documentationHref("/")}>
            Docs
          </a>
          {!user && (
            <a className={b.topLink} href="/app/institution">
              Institution sign in
            </a>
          )}
          {!user && <ConnectAction className={b.primary} />}
          {user ? (
            <AccountMenu label={displayName} items={menuItems} />
          ) : (
            <span className={b.phoneOnly}>
              <AccountMenu label="Menu" items={menuItems} icon />
            </span>
          )}
        </div>
      </header>
      <div className={b.frame}>
        <aside className={b.side} aria-label="Sections">
          <nav aria-label="Main">
            <div className={b.sideGroup}>{main.map((id) => nav(id))}</div>
            <div className={b.sideGroup}>
              <span className={b.sideLabel}>Tools</span>
              {TOOLS.map((id) => nav(id))}
            </div>
          </nav>
          <div className={b.sideBottom}>
            <nav aria-label="Account">{nav("settings")}</nav>
            <button onClick={openGuide}>How it works</button>
            <a href={marketingHref("/contact")}>Contact support</a>
            {user && (
              <button onClick={signOut} disabled={signingOut}>
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            )}
          </div>
        </aside>
      <main id="account-main" className={b.main} ref={mainRef}>
        {error && (
          <p className={`${b.banner} ${b.systemBanner}`} role="alert">
            {error}
          </p>
        )}
        {batch.pending && (
          <div className={`${b.banner} ${b.systemBanner}`} role="status">
            <p>
              A transaction on {PRODUCT.token} {PRODUCT.tag} is still
              unconfirmed. New actions stay locked until it is checked.
            </p>
            <div className={b.requestActions}>
              {batch.pending.hash && (
                <a
                  href={crosschain.explorer + "/tx/" + batch.pending.hash}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction ↗
                </a>
              )}
              <label className={b.field}>
                <span>
                  {batch.pending.hash
                    ? "Replaced it in your wallet? Paste the new hash"
                    : "Transaction hash from your wallet"}
                </span>
                <span className={b.amount}>
                  <input
                    placeholder="0x…"
                    spellCheck={false}
                    autoComplete="off"
                    value={batch.recoveryHash}
                    onChange={(event) =>
                      batch.setRecoveryHash(event.target.value)
                    }
                  />
                </span>
              </label>
              <button
                className={b.secondary}
                onClick={batch.recover}
                disabled={batch.busy}
              >
                Check confirmation
              </button>
              {batch.retrySaved && (
                <button
                  className={b.secondary}
                  onClick={batch.retrySaved}
                  disabled={batch.busy}
                  title="Sends the same request with the same nonce, so it can run only once"
                >
                  Reopen in wallet
                </button>
              )}
            </div>
            {batch.message && <p className={b.hint}>{batch.message}</p>}
          </div>
        )}
        {/* Collecting and cancelling happen on rows that then disappear, so
            their outcome is said here, on whichever page the person is. */}
        {batch.message && !batch.busy && ["claim", "cancel"].includes(batch.lastKind) && (
          <p
            className={`${b.banner} ${batch.succeeded ? b.doneBanner : b.systemBanner}`}
            role="status"
          >
            <span>{batch.message}</span>
            <button className={b.linkButton} onClick={batch.clearMessage}>
              Dismiss
            </button>
          </p>
        )}
        <MoveNotice
          summary={move}
          guest={!user}
          href={"/app/" + mode + PATHS.move}
          onOpen={() => navigate("move")}
        />
        {route.view === "overview" && (
          <PortfolioPage
            book={book}
            user={user}
            batch={batch}
            mine={mine}
            account={account}
            move={move}
            navigate={navigate}
            institution={institution}
          />
        )}
        {route.view === "earn" && (
          <VaultPage
            book={book}
            user={user}
            batch={batch}
            navigate={navigate}
            intent={intent}
          />
        )}
        {route.view === "index" && (
          <IndexPage book={book} navigate={navigate} />
        )}
        {route.view === "activity" && (
          <ActivityPage
            book={book}
            user={user}
            mine={mine}
            account={account}
            batch={batch}
            navigate={navigate}
          />
        )}
        {route.view === "transparency" && (
          <TransparencyPage book={book} navigate={navigate} />
        )}
        {route.view === "developers" && (
          <DeveloperCenter user={user} navigate={navigate} />
        )}
        {route.view === "settings" && (
          <div className={b.page}>
            <header className={b.pageHead}>
              <h1 tabIndex={-1}>Account</h1>
            </header>
            {!user ? (
              <div className={b.guestAccount}>
                <p>
                  Sign in with your wallet to see the wallet this account
                  uses and how you sign in. Your balance is in Portfolio.
                  Signing in moves no funds and grants no approvals.
                </p>
                <ConnectAction className={b.primary} />
              </div>
            ) : institution ? (
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
            )}
          </div>
        )}
        <footer className={b.footer}>
          <span>Thesauros</span>
          <button className={b.linkButton} onClick={openGuide}>
            How it works
          </button>
          <a href={marketingHref("/security")}>Security</a>
          <a href={documentationHref("/")}>Documentation</a>
          <a href={marketingHref("/contact")}>Contact</a>
        </footer>
      </main>
      </div>
      <nav
        className={b.dock}
        aria-label="Quick navigation"
        style={{ gridTemplateColumns: `repeat(${dock.length}, minmax(0, 1fr))` }}
      >
        {dock.map((id) => nav(id, true))}
      </nav>
      {guide && (
        <QuickGuide
          steps={vaultGuide}
          open
          onClose={() => setGuide(false)}
          navigate={(id) => {
            setGuide(false);
            navigate(id === "overview" && !user ? "earn" : id);
          }}
          returnFocusRef={guideOpener}
        />
      )}
    </div>
  );
}
