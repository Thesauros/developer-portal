"use client";
import { useEffect, useState } from "react";
import { MIGRATION_VAULT_IDS } from "../../../lib/migration-state.mjs";
import { isFinished } from "./finished";
import { money } from "../book/parts";
import m from "./move.module.css";

const units = (value) =>
  /^\d+$/.test(String(value ?? "")) ? Number(BigInt(value)) / 1e6 : 0;

// What a wallet still has to do about the vaults before the product, in one
// object every screen reads: the strip at the top, Portfolio and the move app.
// Only figures read from the chain count; a position still loading or one the
// RPC could not read is not reported as empty or as money.
export function moveSummary(migration, previous = [], finished = {}) {
  const rows = (migration?.products || []).filter(
    (product) => product.positionStatus === "ready",
  );
  const moves = rows
    .map((product) => {
      const inVault = units(product.shares) > 0 ? units(product.assets) : 0;
      const toDeposit = units(product.amount);
      const settling = ["settlement", "claim", "deposit_pending"].includes(
        product.stage,
      );
      return {
        id: product.id,
        network: product.name,
        stage: product.stage,
        inVault,
        toDeposit,
        settling,
        collect: product.stage === "claim",
        started: units(product.withdrawn) > 0 || !!product.recovery,
        done: isFinished(product, finished),
      };
    })
    .filter((move) => !move.done);
  // Previous vaults on networks the move does not cover: withdraw only.
  const others = previous
    .filter((vault) => !MIGRATION_VAULT_IDS.includes(vault.id))
    .map((vault) => ({
      id: vault.id,
      network: vault.place,
      token: vault.token,
      balance: vault.position.balance,
    }));
  const inVault = moves.reduce((sum, move) => sum + move.inVault, 0);
  const toDeposit = moves.reduce((sum, move) => sum + move.toDeposit, 0);
  const state = moves.some((move) => move.collect)
    ? "collect"
    : moves.some((move) => move.settling)
      ? "settling"
      : moves.some((move) => move.started)
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
    toDeposit,
    // What is still outside the product because of the move.
    amount: inVault + toDeposit,
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
  const { state, inVault, toDeposit, networks, others } = summary;
  if (state === "collect")
    return {
      title: "Your shares are ready to collect",
      body: "The deposit from your move has settled. One confirmation finishes it.",
      action: "Collect shares",
    };
  if (state === "settling")
    return {
      title: "Your move is settling",
      body: "The deposit is in the open batch. Nothing to do until it settles.",
      action: "See progress",
    };
  if (state === "continue")
    return {
      title: "Your move is not finished",
      body:
        toDeposit > 0
          ? `${money(toDeposit)} USDC from a previous vault is waiting to be deposited.`
          : `${money(inVault)} USDC is still in a previous vault.`,
      action: "Continue the move",
    };
  if (state === "start")
    return {
      title: `You have ${money(inVault)} USDC in a previous vault`,
      body: `Thesauros now runs on one vault that lends across networks. Your money on ${list(networks)} stays yours and can be moved in a few steps.`,
      action: "Move to the new vault",
    };
  if (state === "withdraw")
    return {
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
          <strong>Used Thesauros before November 2026?</strong> It now runs on
          one vault that lends across networks. Money in the previous vaults
          stays yours.
        </p>
        <a className={m.noticeAction} href={href} onClick={open}>
          Move it to the new vault
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
      className={`${m.notice} ${summary.state === "collect" ? m.noticeReady : ""}`}
      role="status"
      aria-label="Move from a previous vault"
    >
      <span className={m.noticeMark} aria-hidden="true">
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
