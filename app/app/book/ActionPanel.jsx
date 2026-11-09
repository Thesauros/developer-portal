"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { formatUnits } from "viem";
import {
  crosschainAmount,
} from "../../../lib/crosschain-transactions.mjs";
import { crosschain } from "../../../lib/crosschain-config.mjs";
import { getVault, vaults as standardVaults } from "../../../lib/vault-contracts.mjs";
import { requestStage, REQUEST_STEPS } from "../../../lib/crosschain-feed.mjs";
import { sharesForAmount } from "../../../lib/vault-metrics.mjs";
import { TransactionPanel } from "./InstantTransaction";
import { ConnectAction } from "../wallet/WalletAccess";
import {
  compact,
  dateLabel,
  hourOnly,
  money,
  pct,
  Segmented,
  Stage,
  NetworkMarks,
} from "./parts";
import b from "./book.module.css";

const WalletFunding = dynamic(() => import("../WalletFunding"));
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
                {position.earned != null
                  ? money(position.earned, Math.abs(position.earned) < 1 ? 4 : 2)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>In your wallet</dt>
              <dd>
                {position.inWallet != null ? money(position.inWallet) : "—"}{" "}
                {vault.depositNetwork}
              </dd>
            </div>
          </dl>
      </>
    </div>
  );
}

function Notice({ vault }) {
  if (!vault.notice) return null;
  return (
    <details className={b.notice} open>
      <summary>Before you deposit</summary>
      <ul>
        {vault.stage === "Pilot" && (
          <li>
            A pilot that runs with team funds. Deposits are open in this build
            for testing; outside money is not part of its plan yet.
          </li>
        )}
        {vault.notice.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <a href="#risks">All risks</a>
    </details>
  );
}

// Your USDC is on another network: say so instead of showing an empty form.
function WrongNetwork({ vault, wallet, navigate }) {
  if (!wallet?.length) return null;
  const here = wallet.find(
    (row) => row.network === vault.depositNetwork && row.token === vault.token,
  );
  if (here && here.amount >= (vault.minDeposit ?? 0)) return null;
  const elsewhere = wallet.filter((row) => row.network !== vault.depositNetwork);
  if (!elsewhere.length) return null;
  const top = [...elsewhere].sort((a, c) => c.amount - a.amount)[0];
  return (
    <p className={b.hintBox}>
      You have {money(top.amount)} {top.token} on {top.network}. This vault
      takes {vault.token} on {vault.depositNetwork}. Bridge it there with your
      wallet, or{" "}
      <button
        className={b.linkButton}
        onClick={() =>
          navigate(
            "vault",
            standardVaults.find(
              (item) => item.name === top.network && item.symbol === top.token,
            )?.id || vault.id,
          )
        }
      >
        see the {top.token} vault on {top.network}
      </button>
      .
    </p>
  );
}

function GuestForm({ vault, action, setAction }) {
  const [amount, setAmount] = useState("");
  // The batch vault takes at most this much in one batch.
  const maxBatch =
    vault.kind === "batch" && vault.limits?.maxEpochDeposits
      ? Number(vault.limits.maxEpochDeposits) / 10 ** (vault.decimals || 6)
      : null;
  const value = Number(amount.replace(/[^\d.]/g, "")) || 0;
  const closed = action === "deposit" && !vault.open.deposits;
  function remember(next) {
    setAmount(next);
    saveDraft({ vaultId: vault.id, action, amount: next });
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
          Withdrawing needs the wallet that holds your shares.{" "}
          {vault.kind === "batch"
            ? "A withdrawal is requested now and paid when the next batch settles."
            : "It is paid in one transaction."}
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
      {!closed && action === "deposit" && maxBatch != null && value > maxBatch && (
        <p className={b.hintBad}>
          At most {money(maxBatch, 0)} {vault.token} fit in one batch; the rest
          can go in the next one.
        </p>
      )}
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

// A vault that takes no new money and holds none of yours: say so, and only
// offer a way in to people who already hold shares.
function ClosedPanel({ vault, user }) {
  return (
    <div className={b.form}>
      <p className={b.closedTitle}>Not open for deposits</p>
      <p className={b.hint}>
        It runs with team funds while it is being prepared. Everything it does
        is shown on this page.
      </p>
      {!user?.walletAddress && (
        <p className={b.footnote}>
          Already hold shares?{" "}
          <ConnectAction className={b.linkButton} label="Connect to withdraw" />
        </p>
      )}
    </div>
  );
}

function ClosedDeposits() {
  return (
    <p className={b.hintBox}>
      This vault is not open for deposits yet. It runs with team funds while it
      is being prepared. Everything it does is shown on this page.
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
          { value: "withdraw", label: "Withdraw", disabled: !heldShares },
        ]}
      />
      {closed ? (
        <ClosedDeposits />
      ) : !reviewing ? (
        <>
          {deposit && (
            <WrongNetwork vault={vault} wallet={wallet} navigate={navigate} />
          )}
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
          {!deposit && shares != null && shares > 0n && !problem && (
            <p className={b.hint}>
              About {money(typed)} USDC ({money(Number(shares) / 1e6, 4)}{" "}
              shares). Set at settlement
              {atMost != null ? `, at most ${money(Number(atMost) / 1e6)} USDC, possibly lower` : ""}
              . You can cancel until this batch closes.
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
                  : "Request the withdrawal. You can cancel until the batch closes."}
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

function InstantForm({ vault, account, user, action, setAction, initial, navigate, wallet }) {
  const definition = getVault(vault.id);
  const [locked, setLocked] = useState(false);
  const [funding, setFunding] = useState(false);
  const fundingOpener = useRef(null);
  const position = account.vaults.find((row) => row.id === vault.id);
  const pending = account.transactions.find(
    (tx) => tx.vaultId === vault.id && ["pending", "unknown"].includes(tx.status),
  );
  return (
    <div className={b.form}>
      <Segmented
        label="Action"
        value={action}
        onChange={(next) => {
          if (!locked && !pending) setAction(next);
        }}
        options={[
          { value: "deposit", label: "Deposit" },
          { value: "withdraw", label: "Withdraw" },
        ]}
      />
      {action === "deposit" && (
        <WrongNetwork vault={vault} wallet={wallet} navigate={navigate} />
      )}
      <TransactionPanel
        key={vault.id}
        embedded
        initialAmount={initial?.amount}
        vault={definition}
        position={position}
        account={account}
        owner={user.walletAddress}
        mode={action}
        setMode={setAction}
        setLocked={setLocked}
        pending={pending}
        onFunding={(event) => {
          fundingOpener.current = event.currentTarget;
          setFunding(true);
        }}
      />
      {funding && (
        <WalletFunding
          key={vault.id}
          vault={definition}
          owner={user.walletAddress}
          onClose={() => setFunding(false)}
          onRefresh={async () => {
            const rows = await account.refresh();
            return (
              rows?.some(
                (row) => row?.id === vault.id && row.status === "ready",
              ) ?? false
            );
          }}
          loading={account.loading}
          returnFocusRef={fundingOpener}
        />
      )}
    </div>
  );
}

// Everything a person does with one vault, in one place. Below the wide layout
// it lives in a sheet opened from the bar at the bottom of the screen.
// One product, several networks: the panel works with the vault on the network
// chosen here, and says plainly what that vault is.
function NetworkChoice({ vault, choices, onChoose, wallet, action }) {
  // The product is one; the network is only where the money comes from or
  // goes back to. Each network's vault has its own rate, said in one line.
  const warn = vault.audit?.state && vault.audit.state !== "reviewed";
  const [changing, setChanging] = useState(false);
  if (!changing)
    return (
      <div className={b.networkChoice}>
        <p className={b.fromLine}>
          <span>
            {action === "withdraw" ? "On" : "From"} <strong>{vault.place}</strong>
            {" · "}
            {pct(vault.rateNow)} now
            {vault.stage && vault.stage !== "Live" ? ` · ${String(vault.stage).toLowerCase()} stage` : ""}
            {warn ? ` · ${vault.audit.label}` : ""}
          </span>
          <button className={b.linkButton} onClick={() => setChanging(true)}>
            Change
          </button>
        </p>
      </div>
    );
  // The choice as a short list: each network with its rate now and what the
  // wallet holds there, the current one marked.
  return (
    <div className={b.networkChoice}>
      <p className={b.fromLine}>
        <span>{action === "withdraw" ? "Withdraw on" : "Deposit from"}</span>
        <button className={b.linkButton} onClick={() => setChanging(false)}>
          Done
        </button>
      </p>
      <p className={b.networkNote}>
        One product on every network. Each network’s vault lends to that
        network’s markets, so the rates differ; a young vault’s rate moves
        more with each deposit.
      </p>
      <ul className={b.networkList} role="radiogroup" aria-label="Network">
        {choices.map((choice) => {
          const funds = (wallet || []).find(
            (row) =>
              row.network === choice.depositNetwork && row.token === choice.token,
          );
          const on = choice.id === vault.id;
          return (
            <li key={choice.id}>
              <button
                role="radio"
                aria-checked={on}
                data-on={on ? "" : undefined}
                onClick={() => {
                  onChoose(choice.id);
                  setChanging(false);
                }}
              >
                <NetworkMarks vault={choice} size={18} />
                <span className={b.networkName}>
                  {choice.place}
                  <small>
                    {choice.position.balance > 0
                      ? "your balance is here"
                      : funds
                        ? `${money(funds.amount)} ${choice.token} in wallet`
                        : choice.stage && choice.stage !== "Live"
                          ? `${String(choice.stage).toLowerCase()} stage`
                          : ""}
                  </small>
                </span>
                <span className={b.networkRate}>{pct(choice.rateNow)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ActionPanel({
  vault,
  choices,
  onChoose,
  user,
  account,
  batch,
  wallet,
  navigate,
  intent,
}) {
  const [draft] = useState(() => readDraft(vault.id));
  const [action, setAction] = useState(
    intent?.action === "withdraw" || draft?.action === "withdraw"
      ? "withdraw"
      : "deposit",
  );
  useEffect(() => {
    if (intent?.action) setAction(intent.action);
  }, [intent]);
  const [sheet, setSheet] = useState(false);
  function open(next) {
    setAction(next);
    setSheet(true);
  }
  const hasBalance = vault.position.balance > 0;
  const closedForNew =
    !vault.open.deposits &&
    vault.open.closedByPolicy &&
    !hasBalance &&
    !(vault.position.active?.length > 0);
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
        {choices?.length > 1 && (
          <NetworkChoice
            vault={vault}
            choices={choices}
            onChoose={onChoose}
            wallet={wallet}
            action={action}
          />
        )}
        {user?.walletAddress && <Plate vault={vault} user={user} />}
        {action === "deposit" && vault.open.deposits && <Notice vault={vault} />}
        {closedForNew ? (
          <ClosedPanel vault={vault} user={user} />
        ) : !user ? (
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
        ) : vault.kind === "batch" ? (
          <BatchForm
            vault={vault}
            batch={batch}
            action={action}
            setAction={setAction}
            initial={draft}
            navigate={navigate}
            wallet={wallet}
          />
        ) : (
          <InstantForm
            vault={vault}
            account={account}
            user={user}
            action={action}
            setAction={setAction}
            initial={draft}
            navigate={navigate}
            wallet={wallet}
          />
        )}
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
        {closedForNew ? (
          <button className={b.secondary} onClick={() => open("deposit")}>
            Not open
          </button>
        ) : (
          <>
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
          </>
        )}
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
export function RequestRow({ request, price, batch, compactVault }) {
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
      <p className={stage.ready ? b.hintGood : b.hint}>{stage.note}</p>
      <div className={b.requestActions}>
        {collectable && (
          <button
            className={b.primary}
            disabled={batch.blocked}
            onClick={() => batch.submit("claim", request.id)}
          >
            Collect {money(collectValue)} USDC
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
