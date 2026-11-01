"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useDisconnect } from "wagmi";
import { documentationHref, marketingHref } from "../../lib/site-links.mjs";
import { workspaceDestination } from "./destination.mjs";
import useEarnAccount from "./useEarnAccount";
import useInsights from "./cabinet/useInsights";
import InstitutionSettings from "./cabinet/InstitutionSettings";
import BrandLoading from "../ui/BrandLoading";
import { buildBook } from "../../lib/vault-book.mjs";
import { BATCH_VAULT_ID } from "../../lib/vault-facts.mjs";
import { crosschain } from "../../lib/crosschain-config.mjs";
import useBatchVault from "./book/useBatchVault";
import { usePublicResource } from "./book/parts";
import { ConnectAction } from "./wallet/WalletAccess";
import PortfolioPage from "./book/PortfolioPage";
import VaultsPage from "./book/VaultsPage";
import VaultPage from "./book/VaultPage";
import ActivityPage from "./book/ActivityPage";
import TransparencyPage from "./book/TransparencyPage";
import { vaultGuide } from "./vault-guide";
import shell from "./workspace.module.css";
import b from "./book/book.module.css";

const loading = () => <BrandLoading />;
const AccountSettings = dynamic(() => import("./AccountSettings"), { loading });
const QuickGuide = dynamic(() => import("./QuickGuide"));
const DeveloperCenter = dynamic(() => import("./DeveloperCenter"), { loading });

// A build can leave the batch vault out altogether.
const batchVaultAvailable =
  process.env.NEXT_PUBLIC_THESAUROS_PRODUCT !== "standard";
// Deposits into the batch vault stay closed until its contracts are ready for
// outside money. Withdrawing, collecting and cancelling always work.
const batchDepositsOpen =
  process.env.NEXT_PUBLIC_THESAUROS_BATCH_DEPOSITS === "open";

const SECTIONS = {
  overview: "Portfolio",
  vaults: "Vaults",
  activity: "Activity",
  transparency: "Transparency",
};
const PATHS = {
  overview: "",
  vaults: "/vaults",
  markets: "/vaults/markets",
  activity: "/activity",
  transparency: "/transparency",
  developers: "/developers",
  settings: "/account",
};
// Where an old link or a section name leads now.
const LEGACY = {
  earn: "vaults",
  single: "vaults",
  crosschain: "vaults",
};
function parseRoute(pathname, mode, known) {
  const prefix = "/app/" + mode;
  const parts = pathname.startsWith(prefix)
    ? pathname.slice(prefix.length).split("/").filter(Boolean)
    : [];
  if (!parts.length) return { view: "overview" };
  if (parts[0] === "vaults") {
    if (parts[1] === "markets") return { view: "markets" };
    if (parts[1] && known.has(parts[1])) return { view: "vault", id: parts[1] };
    return { view: "vaults" };
  }
  if (parts[0] === "account") return { view: "settings" };
  if (["activity", "transparency", "developers"].includes(parts[0]))
    return { view: parts[0] };
  return { view: "overview" };
}
const STANDARD_IDS = ["arbitrum", "base", "monad", "plasma"];

function AccountMenu({ label, items }) {
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
        className={b.accountButton}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        {label}
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
  const includeBatch = batchVaultAvailable;
  const known = useMemo(
    () =>
      new Set([...STANDARD_IDS, ...(includeBatch ? [BATCH_VAULT_ID] : [])]),
    [includeBatch],
  );
  const { disconnectAsync } = useDisconnect();
  const owner = user?.walletAddress;
  const account = useEarnAccount(owner);
  const batch = useBatchVault(user, includeBatch);
  const market = useInsights("market", "30d", true);
  const mine = useInsights("account", "", !!owner);
  const history = usePublicResource("/api/vaults/history", {
    refreshMs: 300000,
  });
  const [route, setRoute] = useState({ view: user ? "overview" : "vaults" });
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
        includeBatch,
        depositsOpen: batchDepositsOpen,
      }),
    [
      market.data,
      account.vaults,
      mine.data,
      history.data,
      batch.feed,
      includeBatch,
    ],
  );

  function navigate(view, id, options) {
    const target = LEGACY[view] || view;
    let next = { view: target };
    let path = PATHS[target];
    if (target === "vault") {
      if (!known.has(id)) return;
      next = { view: "vault", id };
      path = "/vaults/" + id;
      setIntent(options?.action ? { action: options.action, at: Date.now() } : null);
    }
    if (path === undefined) return;
    history_push("/app/" + mode + path);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() =>
      mainRef.current?.querySelector("h1")?.focus({ preventScroll: true }),
    );
  }
  function history_push(path) {
    if (location.pathname !== path) window.history.pushState(null, "", path);
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
      const parsed = parseRoute(location.pathname, mode, known);
      setRoute(!user && parsed.view === "overview" && location.pathname === "/app/" + mode
        ? { view: "vaults" }
        : parsed);
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, [mode, known, user]);

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
  const section =
    route.view === "vault" || route.view === "markets" ? "vaults" : route.view;
  const wallet = book.account.wallet;
  const vault = route.view === "vault" ? book.byId[route.id] : null;
  const nav = (id, label = SECTIONS[id]) => (
    <button
      key={id}
      onClick={() => navigate(id)}
      aria-current={section === id ? "page" : undefined}
    >
      {id === "overview" && institution ? "Treasury" : label}
    </button>
  );
  return (
    <div className={`${shell.shell} ${b.app} ${vault ? b.onVault : ""}`}>
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
        <nav className={b.nav} aria-label="Main">
          {Object.keys(SECTIONS).map((id) => nav(id))}
        </nav>
        <div className={b.topRight}>
          {institution && <span className={b.modeTag}>Institution</span>}
          <a href={documentationHref("/")}>Docs</a>
          {user ? (
            <AccountMenu
              label={displayName}
              items={
                <>
                  <button role="menuitem" onClick={() => navigate("settings")}>
                    Account
                  </button>
                  <button role="menuitem" onClick={() => navigate("developers")}>
                    Developers and partners
                  </button>
                  <button role="menuitem" onClick={openGuide}>
                    How vaults work
                  </button>
                  <a role="menuitem" href={marketingHref("/contact")}>
                    Contact support
                  </a>
                  <button role="menuitem" onClick={signOut} disabled={signingOut}>
                    {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                </>
              }
            />
          ) : (
            <>
              <a href="/app/institution">Institution sign in</a>
              <ConnectAction className={b.primary} />
            </>
          )}
        </div>
      </header>
      <main id="account-main" className={b.main} ref={mainRef}>
        {error && (
          <p className={`${b.banner} ${b.systemBanner}`} role="alert">
            {error}
          </p>
        )}
        {batch.pending && (
          <div className={`${b.banner} ${b.systemBanner}`} role="status">
            <p>
              A transaction on the {crosschain.networks[0].name} +{" "}
              {crosschain.networks[1].name} vault is still unconfirmed. New
              actions on it stay locked until it is checked.
            </p>
            <div className={b.requestActions}>
              {batch.pending.hash ? (
                <a
                  href={crosschain.explorer + "/tx/" + batch.pending.hash}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction ↗
                </a>
              ) : (
                <label className={b.field}>
                  <span>Transaction hash from your wallet</span>
                  <span className={b.amount}>
                    <input
                      value={batch.recoveryHash}
                      onChange={(event) =>
                        batch.setRecoveryHash(event.target.value)
                      }
                    />
                  </span>
                </label>
              )}
              <button
                className={b.secondary}
                onClick={batch.recover}
                disabled={batch.busy}
              >
                Check confirmation
              </button>
            </div>
            {batch.message && <p className={b.hint}>{batch.message}</p>}
          </div>
        )}
        {route.view === "overview" && (
          <PortfolioPage
            book={book}
            user={user}
            batch={batch}
            mine={mine}
            account={account}
            navigate={navigate}
            institution={institution}
          />
        )}
        {(route.view === "vaults" || route.view === "markets") && (
          <VaultsPage
            book={book}
            navigate={navigate}
            user={user}
            tab={route.view}
          />
        )}
        {route.view === "vault" && vault && (
          <VaultPage
            key={vault.id}
            vault={vault}
            user={user}
            account={account}
            batch={batch}
            wallet={wallet}
            navigate={navigate}
            intent={intent}
          />
        )}
        {route.view === "activity" && (
          <ActivityPage
            book={book}
            user={user}
            mine={mine}
            account={account}
            batch={batch}
          />
        )}
        {route.view === "transparency" && (
          <TransparencyPage book={book} navigate={navigate} />
        )}
        {route.view === "developers" && (
          <div className={b.page}>
            <header className={b.pageHead}>
              <h1 tabIndex={-1}>Developers and partners</h1>
            </header>
            <DeveloperCenter user={user} navigate={navigate} />
          </div>
        )}
        {route.view === "settings" && (
          <div className={b.page}>
            <header className={b.pageHead}>
              <h1 tabIndex={-1}>Account</h1>
            </header>
            {!user ? (
              <ConnectAction className={b.primary} />
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
            How vaults work
          </button>
          <a href={marketingHref("/security")}>Security</a>
          <a href={documentationHref("/")}>Documentation</a>
          <a href={marketingHref("/contact")}>Contact</a>
        </footer>
      </main>
      <nav className={b.dock} aria-label="Quick navigation">
        {Object.keys(SECTIONS).map((id) => nav(id))}
      </nav>
      {guide && (
        <QuickGuide
          steps={vaultGuide}
          open
          onClose={() => setGuide(false)}
          navigate={(id) => {
            setGuide(false);
            navigate(id === "overview" ? "vaults" : id);
          }}
          returnFocusRef={guideOpener}
        />
      )}
    </div>
  );
}
