"use client";
import { useEffect, useState } from "react";
import { MIGRATION_VAULT_IDS } from "../../../lib/migration-state.mjs";
import { money } from "../book/parts";
import m from "./move.module.css";

const units = (value) =>
  /^\d+$/.test(String(value ?? "")) ? Number(BigInt(value)) / 1e6 : 0;

// What a wallet still has to do about the vaults before the product, in one
// object every screen reads: the strip at the top, Portfolio and the move app.
// Only figures read from the chain count; a position still loading or one the
// RPC could not read is not reported as empty or as money.
export function moveSummary(migration, previous = []) {
  const rows = (migration?.products || []).filter(
    (product) => product.positionStatus === "ready",
  );
  const moves = rows
    .filter((product) => product.stage !== "complete")
    .map((product) => {
      const inVault = units(product.shares) > 0 ? units(product.assets) : 0;
      return {
        id: product.id,
        network: product.name,
        stage: product.stage,
        // Where this move's money is, each dollar in one place.
        inVault,
        inWallet: units(product.amount),
        inBatch: units(product.queued),
        moved: Math.max(0, units(product.credited) - units(product.queued)),
        settling: ["settlement", "deposit_pending"].includes(product.stage),
        collect: product.stage === "claim",
        started: units(product.withdrawn) > 0 || !!product.recovery,
      };
    });
  // A position the account's own reader sees, where the move's reader has
  // nothing yet (the wallet is not connected in this browser, or it is still
  // loading): it is still money in a previous vault.
  for (const vault of previous) {
    if (!MIGRATION_VAULT_IDS.includes(vault.id)) continue;
    if (moves.some((move) => move.id === vault.id)) continue;
    if ((migration?.products || []).some((product) => product.id === vault.id && product.stage === "complete" && product.positionStatus === "ready"))
      continue;
    moves.push({
      id: vault.id,
      network: vault.place,
      stage: "withdraw",
      inVault: vault.position.balance,
      inWallet: 0,
      inBatch: 0,
      moved: 0,
      settling: false,
      collect: false,
      started: false,
    });
  }
  // Previous vaults on networks the move does not cover: withdraw only.
  const others = previous
    .filter((vault) => !MIGRATION_VAULT_IDS.includes(vault.id))
    .map((vault) => ({
      id: vault.id,
      network: vault.place,
      token: vault.token,
      balance: vault.position.balance,
    }));
  const sum = (key) => moves.reduce((total, move) => total + move[key], 0);
  const inVault = sum("inVault");
  const inWallet = sum("inWallet");
  const inBatch = sum("inBatch");
  const state = moves.some((move) => move.collect)
    ? "collect"
    : moves.some((move) => move.settling)
      ? "settling"
      : moves.some((move) => move.inWallet > 0 || (move.started && move.stage !== "withdraw"))
        ? "continue"
        : moves.length
          ? "start"
          : others.length
            ? "withdraw"
            : "none";
  return {
    state,
    moves,
    others,
    inVault,
    inWallet,
    inBatch,
    // What is still outside the vault because of the move.
    amount: inVault + inWallet,
    networks: [...new Set(moves.filter((move) => move.inVault > 0).map((move) => move.network))],
    checking:
      !!migration?.owner &&
      (migration.products || []).some(
        (product) => product.positionStatus === "loading",
      ),
  };
}

const list = (items) =>
  items.length < 2
    ? items.join("")
    : items.slice(0, -1).join(", ") + " and " + items.at(-1);

function text(summary) {
  const { state, inVault, inWallet, inBatch, networks, others } = summary;
  const still =
    inVault > 0 ? ` ${money(inVault)} USDC is still in the previous vault.` : "";
  if (state === "collect")
    return {
      tone: "ready",
      title: "Your shares are ready to collect",
      body: `${money(inBatch)} USDC of your move has settled in the new vault.${still}`,
      action: "Collect shares",
    };
  if (state === "settling")
    return {
      tone: "calm",
      title: "Your move is settling",
      body: `${money(inBatch)} USDC is in the vault’s open batch. Nothing to do until it settles.${still}`,
      action: "See progress",
    };
  if (state === "continue")
    return {
      tone: "warn",
      title: "Your move is not finished",
      body:
        inWallet > 0
          ? `${money(inWallet)} USDC you withdrew is in your wallet, not earning, waiting to be deposited.${still}`
          : inVault > 0
            ? `${money(inVault)} USDC is still in the previous vault.`
            : "A transaction of your move is waiting to be confirmed.",
      action: "Continue the move",
    };
  if (state === "start")
    return {
      tone: "warn",
      title: `${money(inVault)} USDC of yours is in a previous vault`,
      body: `Thesauros now runs on one vault that lends across networks. Your money on ${list(networks)} stays yours and keeps earning there until you move it.`,
      action: "See how to move it",
    };
  if (state === "withdraw")
    return {
      tone: "warn",
      title: "You have money in a previous vault",
      body: `${list(others.map((row) => `${money(row.balance)} ${row.token} on ${row.network}`))}. That vault takes no new deposits; you can withdraw at any time.`,
      action: "Withdraw",
    };
  return null;
}

const DISMISSED = "thesauros.move.guestNotice";

// The strip at the top of every page. It appears for a wallet with money in a
// previous vault or a move under way, and stays until that is done. A guest sees
// a quieter line once, since the app cannot tell who used the vaults before.
export default function MoveNotice({ summary, guest, href, onOpen }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem(DISMISSED) === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  const open = (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onOpen();
  };
  if (guest) {
    if (hidden) return null;
    return (
      <aside className={`${m.notice} ${m.noticeQuiet}`} aria-label="Previous vaults">
        <p>
          <strong>Used Thesauros before November 2026?</strong>{" "}
          <span className={m.hideOnPhone}>
            It now runs on one vault that lends across networks. Money in the
            previous vaults stays yours.
          </span>
        </p>
        <a className={m.noticeAction} href={href} onClick={open}>
          Move to the new vault
        </a>
        <button
          className={m.noticeClose}
          aria-label="Hide this notice"
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISSED, "1");
            } catch {
              /* Hidden for this visit only. */
            }
            setHidden(true);
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </aside>
    );
  }
  const copy = summary && text(summary);
  if (!copy) return null;
  return (
    <aside
      className={`${m.notice} ${copy.tone === "ready" ? m.noticeReady : copy.tone === "calm" ? m.noticeCalm : ""}`}
      role="status"
      aria-label="Move from a previous vault"
    >
      <span className={m.noticeMark} aria-hidden="true">
        {copy.tone === "warn" ? (
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              d="M12 3.5 21.5 20h-19L12 3.5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
            <path d="M12 10v4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="17.2" r="1.1" fill="currentColor" />
          </svg>
        ) : copy.tone === "ready" ? (
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20">
            <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <p>
        <strong>{copy.title}</strong> {copy.body}
      </p>
      <a className={m.noticeAction} href={href} onClick={open}>
        {copy.action}
      </a>
    </aside>
  );
}
