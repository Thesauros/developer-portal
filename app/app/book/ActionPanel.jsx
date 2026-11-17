"use client";
import { useEffect, useRef, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { formatUnits } from "viem";
import { crosschainAmount } from "../../../lib/crosschain-transactions.mjs";
import { crosschain } from "../../../lib/crosschain-config.mjs";
import { requestStage, REQUEST_STEPS } from "../../../lib/crosschain-feed.mjs";
import { sharesForAmount } from "../../../lib/vault-metrics.mjs";
import { ConnectAction } from "../wallet/WalletAccess";
import { dateLabel, hourOnly, money, pct, Segmented } from "./parts";
import { documentationHref } from "../../../lib/site-links.mjs";
import b from "./book.module.css";

const DRAFT = "thesauros.draft";
function readDraft(vaultId) {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT) || "null");
    if (draft?.vaultId === vaultId) {
      sessionStorage.removeItem(DRAFT);
      return draft;
    }
  } catch {
    /* A draft is a convenience. */
  }
  return null;
}
function saveDraft(draft) {
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify(draft));
  } catch {
    /* A draft is a convenience. */
  }
}

// The balance on the one blue surface of the screen.
function Plate({ vault, user }) {
  const { position } = vault;
  const parts = [
    position.leaving + position.out > 0 &&
      `${money(position.leaving + position.out)} leaving`,
    position.arriving > 0 && `${money(position.arriving)} arriving`,
    position.ready > 0 && `${money(position.ready)} to collect`,
    (position.leaving + position.out > 0 || position.arriving > 0) &&
      position.earning > 0 &&
      `${money(position.earning)} earning`,
  ].filter(Boolean);
  return (
    <div className={b.plate}>
      <span>Your balance in this vault</span>
      <>
          <strong>
            {position.known ? money(position.balance) : "—"}{" "}
            <small>{vault.token}</small>
          </strong>
          {parts.length > 0 && <p>{parts.join(", ")}</p>}
          <dl>
            <div>
              <dt>Earned</dt>
              <dd>
                {position.earned == null
                  ? "—"
                  : Math.abs(position.earned) < 0.00005
                    ? "0.00"
                    : money(position.earned, Math.abs(position.earned) < 1 ? 4 : 2)}
              </dd>
            </div>
            <div>
              <dt>In your wallet</dt>
              <dd>
                {position.inWallet != null ? money(position.inWallet) : "—"}{" "}
                <small>USDC on {vault.depositNetwork}</small>
              </dd>
            </div>
          </dl>
      </>
    </div>
  );
}

// What a depositor has to know first, in one breath; the full list is in the
// documentation.
export function Notice({ vault }) {
  if (!vault.notice) return null;
  return (
    <p className={b.noticeLine}>
      <strong>Before you deposit:</strong> these contracts have no external
      audit yet, one team key can upgrade them, and Thesauros publishes the
      vault’s valuation itself.{" "}
      <a href={documentationHref("/security/risks/")}>All risks</a>
    </p>
  );
}

// The vault takes a fixed amount of deposits per batch: say it before the
// amount is typed, not after it is refused.
function BatchRoom({ vault }) {
  if (vault.batchLimit == null) return null;
  return (
    <p className={b.hint}>
      Up to {money(vault.batchLimit, 0)} USDC per batch for now
      {vault.batchRoom != null ? `; the open batch has room for ${money(vault.batchRoom)}` : ""}.
    </p>
  );
}

// Your USDC is on another network: say so instead of showing an empty form.
function WrongNetwork({ vault, wallet }) {
  if (!wallet?.length) return null;
  const here = wallet.find(
    (row) => row.network === vault.depositNetwork && row.token === vault.token,
  );
  if (here && here.amount >= (vault.minDeposit ?? 0)) return null;
  const elsewhere = wallet.filter(
    (row) => row.network !== vault.depositNetwork && row.token === vault.token,
  );
  if (!elsewhere.length) return null;
  const top = [...elsewhere].sort((a, c) => c.amount - a.amount)[0];
  return (
    <p className={b.hintBox}>
      You have {money(top.amount)} {top.token} on {top.network}. The vault
      takes {vault.token} on {vault.depositNetwork}: send it there with the
      bridge in your wallet, to the same address, then deposit.
    </p>
  );
}

function GuestForm({ vault, action, setAction }) {
  const [amount, setAmount] = useState("");
  // The vault takes at most this much in one batch.
  const maxBatch = vault.batchLimit;
  const value = Number(amount.replace(/[^\d.]/g, "")) || 0;
  const closed = action === "deposit" && !vault.open.deposits;
  function remember(next) {
    // Digits and one decimal point: anything else is not an amount.
    const clean = next.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
    setAmount(clean);
    saveDraft({ vaultId: vault.id, action, amount: clean });
  }
  return (
    <div className={b.form}>
      <Segmented
        label="Action"
        value={action}
        onChange={setAction}
        options={[
          { value: "deposit", label: "Deposit" },
          { value: "withdraw", label: "Withdraw" },
        ]}
      />
      {closed ? (
        <ClosedDeposits />
      ) : action === "withdraw" ? (
        // A guest has nothing to withdraw yet: say what withdrawing takes.
        <p className={b.hint}>
          Withdrawing needs the wallet that holds your shares. A withdrawal
          is requested now and paid when the next batch settles.
        </p>
      ) : (
        <label className={b.field}>
          <span>Amount</span>
          <span className={b.amount}>
            <input
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              onChange={(event) => remember(event.target.value)}
            />
            {vault.token}
          </span>
        </label>
      )}
      {!closed && action === "deposit" && value > 0 && vault.rateNow != null && (
        <p className={b.hint}>
          About {money((value * vault.rateNow) / 100 / 12)} {vault.token} a
          month at today’s {pct(vault.rateNow)}, before fees. Rates change.
        </p>
      )}
      <ConnectAction
        className={b.primary}
        label={
          action === "deposit" && !closed
            ? "Connect wallet to deposit"
            : "Connect wallet"
        }
      />
      {!closed && action === "deposit" &&
        (maxBatch != null && value > maxBatch ? (
          <p className={b.hintBad}>
            At most {money(maxBatch, 0)} {vault.token} fit in one batch; the rest
            can go in a later one.
          </p>
        ) : (
          <BatchRoom vault={vault} />
        ))}
      <p className={b.hint}>
        Connect a wallet, then sign a message to continue. Signing does not move
        funds.{" "}
        {action === "withdraw"
          ? `Withdrawals are paid on ${vault.depositNetwork}.`
          : `Deposits are made on ${vault.depositNetwork}.`}
      </p>
    </div>
  );
}

// Deposits can be stopped by the contract or by this deployment. Money already
// in the vault is never locked in by that.
function ClosedDeposits() {
  return (
    <p className={b.hintBox}>
      Deposits are paused right now. Withdrawing, collecting and cancelling
      work as usual.
    </p>
  );
}

function BatchForm({ vault, batch, action, setAction, initial, navigate, wallet }) {
  const { openConnectModal } = useConnectModal();
  const { feed } = batch;
  const deposit = action === "deposit";
  const [amount, setAmount] = useState(initial?.amount || "");
  const [useAll, setUseAll] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  // Switching between deposit and withdraw starts clean; the first render must
  // not clear an amount carried through sign-in.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setAmount("");
    setUseAll(false);
    setReviewing(false);
    batch.clearMessage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);
  const user = feed?.user;
  const chain = feed?.vault;
  const price = chain?.tick?.rateBid;
  const heldShares = /^\d+$/.test(String(user?.shares ?? ""))
    ? BigInt(user.shares)
    : 0n;
  let parsed = null;
  try {
    if (amount) parsed = crosschainAmount(amount);
  } catch {
    parsed = null;
  }
  const available = deposit ? user?.cash : user?.valueBid;
  const allowance = /^\d+$/.test(String(user?.allowance ?? ""))
    ? BigInt(user.allowance)
    : 0n;
  const needsApproval = deposit && parsed != null && allowance < parsed;
  const minimum = chain?.limits?.minDeposit;
  const room =
    chain?.limits?.maxEpochDeposits != null
      ? BigInt(chain.limits.maxEpochDeposits) -
        BigInt(chain.accounting?.pendingDeposits ?? 0)
      : null;
  const shares =
    !deposit && parsed != null && /^\d+$/.test(String(price ?? ""))
      ? useAll
        ? heldShares
        : sharesForAmount(parsed, price, heldShares)
      : null;
  const free = vault.capital?.free ?? null;
  const typed = parsed == null ? null : Number(parsed) / 1e6;
  const atMost =
    shares != null && chain?.epoch?.openRateBid
      ? (shares * BigInt(chain.epoch.openRateBid)) / 10n ** 18n
      : null;
  const problem = !amount
    ? ""
    : parsed == null
      ? "Enter an amount with up to 6 decimal places."
      : !useAll &&
          /^\d+$/.test(String(available ?? "")) &&
          parsed > BigInt(available)
        ? deposit
          ? `That is more than the ${vault.token} in your wallet on ${vault.depositNetwork}.`
          : "That is more than your balance in this vault."
        : deposit && minimum && parsed < BigInt(minimum)
          ? `The minimum deposit is ${money(Number(minimum) / 1e6)} USDC.`
          : deposit && room != null && parsed > room
            ? `This batch takes ${money(Number(room < 0n ? 0n : room) / 1e6)} USDC more.`
            : "";
  const noGas =
    /^\d+$/.test(String(user?.eth ?? "")) && BigInt(user.eth) === 0n;
  const closed = deposit && !vault.open.deposits;
  const done = batch.succeeded && batch.lastDone;
  function submit() {
    const kind = needsApproval ? "approve" : deposit ? "deposit" : "redeem";
    const input = deposit ? amount : formatUnits(shares, 6);
    batch.submit(kind, input).then((ok) => {
      if (ok && kind !== "approve") {
        setAmount("");
        setUseAll(false);
        setReviewing(false);
      }
    });
  }
  if (
    done &&
    (batch.lastDone.kind === "deposit" || batch.lastDone.kind === "redeem")
  )
    return (
      <div className={b.form} role="status">
        <h3 className={b.formDone}>
          {batch.lastDone.kind === "deposit"
            ? "Deposit requested"
            : "Withdrawal requested"}
        </h3>
        <p className={b.hint}>
          {batch.lastDone.kind === "deposit"
            ? "Your USDC is in the open batch. It starts earning when the batch settles."
            : "Your shares are in the open batch. The USDC amount is set when it settles."}{" "}
          You can close this tab. The request stays on this page and in your
          portfolio until you collect it.
        </p>
        <button className={b.secondary} onClick={batch.clearMessage}>
          Done
        </button>
      </div>
    );
  return (
    <div className={b.form}>
      <Segmented
        label="Action"
        value={action}
        onChange={(next) => {
          if (!batch.busy) setAction(next);
        }}
        options={[
          { value: "deposit", label: "Deposit" },
          {
            value: "withdraw",
            label: "Withdraw",
            disabled: !heldShares,
            title: heldShares ? undefined : "Nothing in the vault to withdraw yet",
          },
        ]}
      />
      {closed ? (
        <ClosedDeposits />
      ) : !reviewing ? (
        <>
          {deposit && <WrongNetwork vault={vault} wallet={wallet} />}
          <label className={b.field}>
            <span>Amount</span>
            <span className={b.amount}>
              <input
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={amount}
                disabled={batch.busy}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setUseAll(false);
                }}
              />
              USDC
              <button
                type="button"
                className={b.max}
                disabled={
                  batch.busy ||
                  !/^\d+$/.test(String(available ?? "")) ||
                  available === "0"
                }
                onClick={() => {
                  setAmount(formatUnits(BigInt(available), 6));
                  setUseAll(!deposit);
                }}
              >
                Max
              </button>
            </span>
          </label>
          <p className={problem ? b.hintBad : b.hint} role="status">
            {problem ||
              (deposit
                ? `${money(Number(user?.cash ?? 0) / 1e6)} ${vault.token} in your wallet on ${vault.depositNetwork}.`
                : `${money(Number(user?.valueBid ?? 0) / 1e6)} USDC in this vault.`)}
          </p>
          {deposit && !problem && <BatchRoom vault={vault} />}
          {!deposit && shares != null && shares > 0n && !problem && (
            <p className={b.hint}>
              About {money(typed)} USDC ({money(Number(shares) / 1e6, 4)}{" "}
              shares). Set at settlement
              {atMost != null ? `, at most ${money(Number(atMost) / 1e6)} USDC, possibly lower` : ""}
              . You can cancel only until this batch closes.
            </p>
          )}
          {!deposit && typed != null && free != null && typed > free && !problem && (
            <p className={b.hintBox}>
              This is more than the {money(free)} USDC of free cash. After it
              settles it waits for funds to return from other networks. No time
              is promised.
            </p>
          )}
          <button
            className={b.primary}
            disabled={
              batch.newRequestsBlocked ||
              !parsed ||
              !!problem ||
              (!deposit && (!shares || shares === 0n))
            }
            onClick={() => setReviewing(true)}
          >
            Review {deposit ? "deposit" : "withdrawal"}
          </button>
        </>
      ) : (
        <>
          <div className={b.review}>
            <span>Review your {deposit ? "deposit" : "withdrawal"}</span>
            <strong>
              {deposit ? "" : "About "}
              {money(typed)} USDC
            </strong>
            <ol>
              {deposit && (
                <li data-done={!needsApproval || undefined}>
                  Approve exactly this amount.
                </li>
              )}
              <li>
                {deposit
                  ? "Request the deposit. You can cancel until the batch settles."
                  : "Request the withdrawal. You can cancel only until its batch closes; a deposit, until it settles."}
              </li>
              <li>
                {deposit
                  ? "When the batch settles your deposit starts earning. Then collect your shares."
                  : "When the batch settles, collect your USDC."}
              </li>
            </ol>
          </div>
          {!batch.walletMatches ? (
            <button className={b.primary} onClick={openConnectModal}>
              Reconnect wallet
            </button>
          ) : (
            <button
              className={b.primary}
              disabled={batch.newRequestsBlocked}
              onClick={submit}
            >
              {batch.busy
                ? "Check your wallet…"
                : needsApproval
                  ? "1. Approve USDC"
                  : deposit
                    ? "Request deposit"
                    : "Request withdrawal"}
            </button>
          )}
          <button
            className={b.linkButton}
            disabled={batch.busy}
            onClick={() => setReviewing(false)}
          >
            Edit amount
          </button>
        </>
      )}
      {batch.migrationBlocked && (
        <p className={b.hintBox}>
          A step of your move from a previous vault is still open.{" "}
          <button className={b.linkButton} onClick={() => navigate("move")}>
            Finish it first
          </button>
          .
        </p>
      )}
      {noGas && !closed && (
        <p className={b.hintBad}>
          You have no {vault.gasToken} on {vault.depositNetwork}. Some wallets
          can pay network fees in {vault.token}; otherwise add a little{" "}
          {vault.gasToken} first.
        </p>
      )}
      {batch.message && !done && (
        <p className={b.hint} role="status">
          {batch.message}
        </p>
      )}
      {done && batch.lastDone.kind === "approve" && (
        <p className={b.hintGood} role="status">
          {batch.message}
        </p>
      )}
    </div>
  );
}

// Everything a person does with the vault, in one place. Below the wide layout
// it lives in a sheet opened from the bar at the bottom of the screen.
export default function ActionPanel({ vault, user, batch, wallet, navigate, intent }) {
  const [draft] = useState(() => readDraft(vault.id));
  const [action, setAction] = useState(
    intent?.action === "withdraw" || draft?.action === "withdraw"
      ? "withdraw"
      : "deposit",
  );
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    if (!intent?.action) return;
    setAction(intent.action);
    // On a phone the form lives in a sheet: an action asked for elsewhere
    // (Portfolio's Deposit) opens it.
    if (window.matchMedia("(max-width: 1279px)").matches) setSheet(true);
  }, [intent]);
  function open(next) {
    setAction(next);
    setSheet(true);
  }
  const hasBalance = vault.position.balance > 0;
  return (
    <>
      <aside
        className={`${b.panel} ${sheet ? b.panelOpen : ""}`}
        aria-label="Your position and actions"
      >
        <button
          className={b.sheetClose}
          onClick={() => setSheet(false)}
          aria-label="Close"
        >
          Close
        </button>
        {user?.walletAddress && <Plate vault={vault} user={user} />}
        {!user ? (
          <GuestForm vault={vault} action={action} setAction={setAction} />
        ) : !user.walletAddress ? (
          <div className={b.form}>
            <p className={b.hint}>
              Link your treasury wallet to deposit and withdraw. Transactions
              are signed in that wallet.
            </p>
            <button
              className={b.primary}
              onClick={() => navigate("settings")}
            >
              Link a wallet
            </button>
          </div>
        ) : (
          <BatchForm
            vault={vault}
            batch={batch}
            action={action}
            setAction={setAction}
            initial={draft}
            navigate={navigate}
            wallet={wallet}
          />
        )}
        {action === "deposit" && vault.open.deposits && <Notice vault={vault} />}
      </aside>
      <div className={b.actionBar}>
        {user?.walletAddress ? (
          <div>
            <span>Your balance</span>
            <strong>
              {vault.position.known ? money(vault.position.balance) : "—"}{" "}
              {vault.token}
            </strong>
          </div>
        ) : (
          <div>
            <span>Rate now</span>
            <strong>{pct(vault.rateNow)}</strong>
          </div>
        )}
        <button className={b.primary} onClick={() => open("deposit")}>
          Deposit
        </button>
        <button
          className={b.secondary}
          disabled={!hasBalance}
          onClick={() => open("withdraw")}
        >
          Withdraw
        </button>
      </div>
      {sheet && (
        <button
          className={b.sheetBackdrop}
          onClick={() => setSheet(false)}
          aria-label="Close"
          tabIndex={-1}
        />
      )}
    </>
  );
}

// One request, from any vault, on any screen.
export function RequestRow({ request, price, batch, compactVault, closing }) {
  const stage = requestStage(request);
  const deposit = request.kind === "deposit";
  const value = deposit
    ? Number(request.amount) / 1e6
    : request.owed != null
      ? Number(request.owed) / 1e6
      : /^\d+$/.test(String(price ?? ""))
        ? Number((BigInt(request.amount) * BigInt(price)) / 10n ** 18n) / 1e6
        : null;
  const collectable = request.state === "claimable";
  const collectValue =
    collectable && deposit && /^\d+$/.test(String(price ?? ""))
      ? Number((BigInt(request.claimable) * BigInt(price)) / 10n ** 18n) / 1e6
      : value;
  return (
    <article className={b.request}>
      <header>
        <h4>
          {deposit ? "Deposit" : "Withdrawal"}
          {deposit || request.owed != null ? " " : " about "}
          {money(value)} USDC
        </h4>
        {compactVault && <span>{compactVault}</span>}
      </header>
      {!stage.cancelled && (
        <ol className={b.journey}>
          {REQUEST_STEPS.map((label, index) => (
            <li
              key={label}
              data-state={
                index < stage.step
                  ? "done"
                  : index === stage.step
                    ? stage.step === 3
                      ? "done"
                      : "current"
                    : "next"
              }
            >
              <span aria-hidden="true" />
              {label}
            </li>
          ))}
        </ol>
      )}
      <p className={stage.ready ? b.hintGood : b.hint}>
        {stage.note}
        {request.state === "pending" && closing && !closing.late ? " " + closing.text : ""}
      </p>
      <div className={b.requestActions}>
        {collectable && (
          <button
            className={b.primary}
            disabled={batch.blocked}
            onClick={() => batch.submit("claim", request.id)}
          >
            {deposit
              ? `Collect shares (${money(collectValue)} USDC)`
              : `Collect ${money(collectValue)} USDC`}
          </button>
        )}
        {request.cancellable && (
          <button
            className={b.secondary}
            disabled={batch.blocked}
            onClick={() => batch.submit("cancel", request.id)}
          >
            Cancel request
          </button>
        )}
        {/^0x[0-9a-f]{64}$/i.test(request.requestedTx || "") && (
          <a
            href={crosschain.explorer + "/tx/" + request.requestedTx}
            target="_blank"
            rel="noreferrer"
          >
            Transaction ↗
          </a>
        )}
      </div>
    </article>
  );
}

// When the open batch closes, without promising more than the contract does.
export function batchClosing(vault) {
  const epoch = vault.epoch;
  if (!epoch || !vault.observedAt) return null;
  const earliest = epoch.earliestCloseAt * 1000,
    latest = epoch.latestCloseAt * 1000;
  if (vault.observedAt > latest)
    return { late: true, text: "This batch is past its closing time." };
  return {
    late: false,
    text: `The open batch closes between ${hourOnly(earliest)} and ${hourOnly(latest)}, ${dateLabel(latest, false)}, if a fresh valuation is published.`,
  };
}
