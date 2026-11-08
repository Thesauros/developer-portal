"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useDisconnect } from "wagmi";
import { documentationHref, marketingHref } from "../../lib/site-links.mjs";
import { workspaceDestination } from "./destination.mjs";
import useEarnAccount from "./useEarnAccount";
import useInsights from "./book/useInsights";
import InstitutionSettings from "./book/InstitutionSettings";
import BrandLoading from "../ui/BrandLoading";
import { buildBook, PRODUCT_IDS, productView } from "../../lib/vault-book.mjs";
import { vaults as standardVaults } from "../../lib/vault-contracts.mjs";
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
import IndexPage from "./book/IndexPage";
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

// The sidebar on a desktop, the dock on a phone. Same sections, same order.
const MAIN = ["overview", "vaults", "activity", "transparency"];
const TOOLS = ["index", "developers", "settings"];
const LABELS = {
  overview: "Portfolio",
  vaults: "Earn",
  activity: "Activity",
  transparency: "Transparency",
  index: "Blue-chip index",
  developers: "Developers",
  settings: "Account",
};
const PATHS = {
  overview: "",
  vaults: "/vaults",
  index: "/blue-chip-index",
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
  vaults: (
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
function parseRoute(pathname, mode, known) {
  const prefix = "/app/" + mode;
  const parts = pathname.startsWith(prefix)
    ? pathname.slice(prefix.length).split("/").filter(Boolean)
    : [];
  if (!parts.length) return { view: "overview" };
  if (parts[0] === "vaults") {
    if (parts[1] === "markets") return { view: "index" };
    if (parts[1] && known.has(parts[1])) {
      const from = new URLSearchParams(location.search).get("from");
      return {
        view: "vault",
        id: parts[1],
        from: from && known.has(from) ? from : null,
      };
    }
    return { view: "vaults" };
  }
  if (parts[0] === "blue-chip-index") return { view: "index" };
  if (parts[0] === "account") return { view: "settings" };
  if (["activity", "transparency", "developers"].includes(parts[0]))
    return { view: parts[0] };
  return { view: "overview" };
}
const STANDARD_IDS = standardVaults.map((vault) => vault.id);

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
  const includeBatch = batchVaultAvailable;
  const known = useMemo(
    () =>
      new Set([
        ...STANDARD_IDS,
        ...PRODUCT_IDS.filter((id) => includeBatch || id !== "usdc-multichain"),
        ...(includeBatch ? [BATCH_VAULT_ID] : []),
      ]),
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
        index: history.data?.index || null,
        indexes: history.data?.indexes || null,
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
      // A vault opens its product's page with that network chosen to deposit from.
      const product =
        book.products.find((item) => item.id === id) || book.productOf[id];
      const productId = product?.id || id;
      const from =
        product && product.id !== id && product.vaults.length > 1 ? id : null;
      next = { view: "vault", id: productId, from };
      path = "/vaults/" + productId + (from ? "?from=" + from : "");
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
  const section = route.view === "vault" ? "vaults" : route.view;
  const wallet = book.account.wallet;
  // The product on the page, and the vault its deposit panel works with: the one
  // asked for, else the one holding the person's money, else the one their
  // wallet can fund, else the largest.
  const product =
    route.view === "vault"
      ? book.products.find((item) => item.id === route.id) ||
        book.productOf[route.id] ||
        null
      : null;
  const pickedId = route.from || (book.byId[route.id] ? route.id : null);
  const vault = product
    ? (pickedId && product.vaults.find((item) => item.id === pickedId)) ||
      product.vaults.find((item) => item.position.balance > 0) ||
      product.vaults.find((item) =>
        wallet.some(
          (row) =>
            row.network === item.depositNetwork && row.token === item.token,
        ),
      ) ||
      product.lead
    : null;
  const view = useMemo(() => (product ? productView(product) : null), [product]);
  function chooseVault(id) {
    if (!product) return;
    const from = id === product.lead.id ? null : id;
    window.history.replaceState(
      null,
      "",
      "/app/" + mode + "/vaults/" + product.id + (from ? "?from=" + from : ""),
    );
    setRoute({ view: "vault", id: product.id, from: id });
  }
  const label = (id) =>
    id === "overview" && institution ? "Treasury" : LABELS[id];
  const nav = (id, compact = false) => (
    <button
      key={id}
      onClick={() => navigate(id)}
      aria-current={section === id ? "page" : undefined}
    >
      <Glyph id={id} />
      <span>{compact && id === "index" ? "Index" : label(id)}</span>
    </button>
  );
  const menuItems = (
    <>
      {TOOLS.map((id) => (
        <button key={id} role="menuitem" onClick={() => navigate(id)}>
          {label(id)}
        </button>
      ))}
      <button role="menuitem" onClick={openGuide}>
        How vaults work
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
            <div className={b.sideGroup}>{MAIN.map((id) => nav(id))}</div>
            <div className={b.sideGroup}>
              <span className={b.sideLabel}>Tools</span>
              {TOOLS.map((id) => nav(id))}
            </div>
          </nav>
          <div className={b.sideBottom}>
            <button onClick={openGuide}>How vaults work</button>
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
              A transaction on the USDC Multichain vault is still
              unconfirmed. New actions on it stay locked until it is checked.
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
        {route.view === "vaults" && (
          <VaultsPage book={book} navigate={navigate} user={user} />
        )}
        {route.view === "index" && (
          <IndexPage book={book} navigate={navigate} />
        )}
        {route.view === "vault" && vault && (
          <VaultPage
            key={product.id}
            view={view}
            vault={vault}
            product={product}
            chooseVault={chooseVault}
            index={product.index || book.index}
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
          <DeveloperCenter user={user} navigate={navigate} />
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
      </div>
      <nav className={b.dock} aria-label="Quick navigation">
        {MAIN.map((id) => nav(id, true))}
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
