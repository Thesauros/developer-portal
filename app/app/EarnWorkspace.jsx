"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useAccount, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { createWalletClient, custom, formatUnits } from "viem";
import {
  vaults,
  getVault,
  displayAmount,
  tokenAmount,
  friendlyTransactionError,
} from "../../lib/vault-contracts.mjs";
import { vaultClients } from "../../lib/vault-rpc.mjs";
import {
  prepareTransaction,
  executeTransaction,
} from "../../lib/vault-transactions.mjs";
import { documentationHref } from "../../lib/site-links.mjs";
import { historyKey } from "../../lib/transaction-history.mjs";
import { balanceLabel, amountFeedback } from "../../lib/earn-presentation.mjs";
import p from "./product.module.css";
import e from "./earn.module.css";

const WalletFunding = dynamic(() => import("./WalletFunding"));
const activeSubmissions = new Set();
const short = (value) =>
  value ? value.slice(0, 6) + "…" + value.slice(-4) : "—";
function percentage(value, decimals = 27) {
  if (value == null) return "—";
  return (Number(formatUnits(BigInt(value), decimals)) * 100).toFixed(2) + "%";
}
function Icon({ type = "wallet" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {type === "layers" ? (
        <>
          <rect x="3" y="3" width="12" height="12" rx="3" />
          <path d="M9 18v1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1" />
          <path d="M7 9h4M9 7v4" />
        </>
      ) : type === "history" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      ) : (
        <>
          <rect x="3" y="5" width="18" height="15" rx="3" />
          <path d="M3 9h18M16 14h2M7 5V3h10v2" />
        </>
      )}
    </svg>
  );
}
function ExplorerLink({ vault, hash, children }) {
  return (
    <a
      href={
        vault.explorer + (hash ? "/tx/" + hash : "/address/" + vault.address)
      }
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}

export default function EarnWorkspace({
  user,
  navigate,
  onGuide,
  account,
  selectedVault = "arbitrum",
  onSelectVault,
  initialAction = "deposit",
}) {
  const selected = selectedVault;
  const setSelected = onSelectVault;
  const [mode, setMode] = useState(
    initialAction === "withdraw" ? "withdraw" : "deposit",
  );
  const [locked, setLocked] = useState(false);
  const form = useRef(null);
  const [funding, setFunding] = useState(false);
  const fundingOpener = useRef(null);
  function openFunding(event) {
    fundingOpener.current = event.currentTarget;
    setFunding(true);
  }
  const vault = getVault(selected);
  const position = account.vaults.find((v) => v.id === selected);
  const ready = position?.status === "ready";
  const emptyPosition = ready && BigInt(position.shares) === 0n;
  const needsFunds =
    ready && BigInt(position.cash) < BigInt(position.minAssets);
  const otherPosition = account.vaults.find(
    (row) =>
      row.id !== selected && row.status === "ready" && BigInt(row.shares) > 0n,
  );
  const otherCash = account.vaults.find(
    (row) =>
      row.id !== selected &&
      row.status === "ready" &&
      !row.depositPaused &&
      BigInt(row.cash) >= BigInt(row.minAssets),
  );
  const other = emptyPosition ? otherPosition || otherCash : null;
  const pending = account.transactions.find(
    (t) => t.vaultId === selected && ["pending", "unknown"].includes(t.status),
  );
  function act(action) {
    setMode(action);
    requestAnimationFrame(() => {
      form.current?.scrollIntoView({ behavior: "auto", block: "center" });
      form.current?.querySelector("input")?.focus({ preventScroll: true });
    });
  }
  return (
    <div className={p.product}>
      <div className={e.vaultSelector} aria-label="Choose your Earn network">
        {vaults.map((v) => {
          const data = account.vaults.find((n) => n.id === v.id);
          return (
            <button
              key={v.id}
              className={e.vaultChoice}
              aria-pressed={v.id === selected}
              disabled={locked}
              onClick={() => setSelected(v.id)}
            >
              <img src={v.icon} alt="" width="28" height="28" />
              <span>
                <strong>
                  {v.symbol} on {v.name}
                </strong>
                <small>
                  {data?.status === "ready"
                    ? BigInt(data.shares) > 0n
                      ? balanceLabel(data.positionAssets) + " in Earn"
                      : balanceLabel(data.cash) + " in wallet"
                    : account.loading
                      ? "Reading onchain data…"
                      : "Balance unavailable"}
                </small>
              </span>
              <span className={e.choiceMark} aria-hidden="true" />
            </button>
          );
        })}
        <button
          className={p.textButton}
          disabled={account.loading}
          onClick={() => account.refresh()}
        >
          {account.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {account.error && (
        <p className={`${p.stateMessage} ${p.error}`} role="alert">
          {account.error}
        </p>
      )}
      <div className={p.earnLayout}>
        <div className={e.positionColumn}>
          <section
            className={`${p.balancePanel} ${p.earnPanel} ${emptyPosition ? e.emptyPosition : ""}`}
            aria-label="Your Earn position"
          >
            <div className={p.panelHeader}>
              <span className={p.balanceLabel}>
                {emptyPosition
                  ? "No active Earn position"
                  : "Your Earn balance"}
              </span>
              <span className={p.networkTag}>
                {vault.name} · {vault.symbol}
              </span>
            </div>
            {emptyPosition ? (
              <div className={e.firstCopy}>
                <h2>Your next Earn deposit.</h2>
                <p>
                  Start with {tokenAmount(position.minAssets)} {vault.symbol} on{" "}
                  {vault.name}. Your wallet holds the shares in the vault.
                </p>
              </div>
            ) : (
              <>
                <div className={p.balanceValue}>
                  {balanceLabel(ready ? position.positionAssets : null)}
                  <span className={p.balanceUnit}>{vault.symbol}</span>
                </div>
                <p className={p.balanceMeta}>
                  {ready
                    ? `Your share of this vault, valued in ${vault.symbol}.`
                    : account.loading
                      ? "Reading your position directly from the vault…"
                      : "Your position is temporarily unavailable."}
                </p>
              </>
            )}
            <div className={e.balanceStats}>
              <div>
                <span>Available in your wallet</span>
                <strong>
                  {balanceLabel(ready ? position.cash : null)}{" "}
                  <small>{vault.symbol}</small>
                </strong>
              </div>
              <div>
                <span>Current gross APR</span>
                <strong>
                  {percentage(ready ? position.rateRay : null)}{" "}
                  <small>variable</small>
                </strong>
              </div>
            </div>
            <div className={p.balanceActions}>
              <button
                className={p.primaryButton}
                onClick={needsFunds ? openFunding : () => act("deposit")}
                disabled={locked || !ready || position.depositPaused}
              >
                {ready && position.depositPaused
                  ? "Deposits paused"
                  : needsFunds
                    ? "Fund your wallet"
                    : emptyPosition
                      ? "Make a deposit"
                      : "Deposit"}
              </button>
              {emptyPosition ? (
                <button className={p.secondaryButton} onClick={onGuide}>
                  How Earn works
                </button>
              ) : (
                <button
                  className={p.secondaryButton}
                  onClick={() => act("withdraw")}
                  disabled={locked || !ready}
                >
                  Withdraw
                </button>
              )}
            </div>
            {other && (
              <button
                className={e.otherNetwork}
                disabled={locked}
                onClick={() => setSelected(other.id)}
              >
                {otherPosition
                  ? `${balanceLabel(other.positionAssets)} ${getVault(other.id).symbol} in Earn on ${getVault(other.id).name}`
                  : `${balanceLabel(other.cash)} ${getVault(other.id).symbol} available on ${getVault(other.id).name}`}
                <span>View {getVault(other.id).name}</span>
              </button>
            )}
            <p className={p.dataNote}>
              Wallet {short(user.walletAddress)} · Assets stay on {vault.name}.
            </p>
          </section>
          {!ready && !account.loading && (
            <div className={`${p.stateMessage} ${p.error}`} role="status">
              {position?.error ||
                "This network did not respond. Refresh to try again."}
            </div>
          )}
          <section className={e.allocation} aria-label="Vault allocation">
            <div className={p.sectionHeader}>
              <div>
                <h2>About this vault</h2>
                <p className={p.sectionCopy}>
                  Withdraw any time; the vault returns your share in{" "}
                  {vault.symbol}.
                </p>
              </div>
              <button
                className={p.textButton}
                onClick={() => navigate("vaults")}
              >
                Rates and allocation
              </button>
            </div>
            <div className={e.vaultFacts}>
              <div>
                <span>Assets in this vault</span>
                <strong>
                  {displayAmount(ready ? position.totalAssets : null)}{" "}
                  {vault.symbol}
                </strong>
              </div>
              <div>
                <span>Management / performance fee</span>
                <strong>
                  {ready
                    ? `${percentage(position.managementFee, 18)} / ${percentage(position.performanceFee, 18)}`
                    : "—"}
                </strong>
              </div>
            </div>
            <details className={e.dataDetails}>
              <summary>Rate details</summary>
              <p className={p.dataNote}>
                Gross APR is the allocation-weighted lending rate before vault
                fees and can change.{" "}
                {ready && (
                  <>
                    Read at{" "}
                    {new Date(position.observedAt).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "UTC",
                    })}{" "}
                    UTC.{" "}
                  </>
                )}
                <a href={documentationHref("/security/controls/")}>
                  Vault controls
                </a>
              </p>
            </details>
          </section>
        </div>
        <div ref={form} className={e.transactionColumn}>
          <TransactionPanel
            key={selected}
            vault={vault}
            position={position}
            account={account}
            owner={user.walletAddress}
            mode={mode}
            setMode={setMode}
            setLocked={setLocked}
            pending={pending}
            onFunding={openFunding}
            onSandbox={() => navigate("test")}
          />
        </div>
      </div>
      {funding && (
        <WalletFunding
          key={selected}
          vault={vault}
          owner={user.walletAddress}
          onClose={() => setFunding(false)}
          onRefresh={async () => {
            const rows = await account.refresh();
            return (
              rows?.some(
                (row) => row?.id === selected && row.status === "ready",
              ) ?? false
            );
          }}
          loading={account.loading}
          onSandbox={() => {
            setFunding(false);
            navigate("test");
          }}
          returnFocusRef={fundingOpener}
        />
      )}
    </div>
  );
}

function TransactionPanel({
  vault,
  position,
  account,
  owner,
  mode,
  setMode,
  setLocked,
  pending,
  onFunding,
  onSandbox,
}) {
  const { address, connector, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const [amount, setAmount] = useState("");
  const [all, setAll] = useState(false);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [message, setMessage] = useState(null);
  const [sentHash, setSentHash] = useState(null);
  const [replacementHash, setReplacementHash] = useState("");
  const [resolving, setResolving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const uncertaintyKey =
    "thesauros.earn.uncertain." + owner.toLowerCase() + "." + vault.id;
  useEffect(() => {
    try {
      setUncertain(localStorage.getItem(uncertaintyKey) === "1");
    } catch {
      /* Wallet activity still available. */
    }
    const sync = (event) => {
      if (event.key === uncertaintyKey) setUncertain(event.newValue === "1");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [uncertaintyKey]);
  function markUncertain(value) {
    setUncertain(value);
    try {
      value
        ? localStorage.setItem(uncertaintyKey, "1")
        : localStorage.removeItem(uncertaintyKey);
    } catch {
      /* Preserve the current in-memory lock. */
    }
  }
  const actionLock = useRef(false);
  const revision = useRef(0);
  const ready = position?.status === "ready";
  const sameWallet = address?.toLowerCase() === owner?.toLowerCase();
  const sameNetwork = chainId === vault.chainId;
  const paused =
    ready &&
    (mode === "deposit" ? position.depositPaused : position.withdrawPaused);
  const balance = ready
    ? mode === "deposit"
      ? position.cash
      : position.positionAssets
    : null;
  const feedback = amountFeedback({ amount, mode, position, all });
  const needsFunds =
    ready &&
    mode === "deposit" &&
    !paused &&
    BigInt(position.cash) < BigInt(position.minAssets);
  const noPosition =
    ready && mode === "withdraw" && BigInt(position.shares) === 0n;
  useEffect(() => {
    revision.current++;
    setReview(null);
    setMessage(null);
    setAmount("");
    setAll(false);
  }, [mode]);
  useEffect(() => {
    setReview(null);
    revision.current++;
  }, [address, chainId]);
  useEffect(() => {
    setLocked(busy);
    return () => setLocked(false);
  }, [busy, setLocked]);
  function edit(value) {
    setAmount(value);
    setAll(false);
    setReview(null);
    setMessage(null);
  }
  async function reviewAmount() {
    if (
      actionLock.current ||
      uncertain ||
      pending ||
      feedback ||
      needsFunds ||
      noPosition
    )
      return;
    actionLock.current = true;
    setBusy(true);
    setMessage(null);
    setStage("Checking the vault…");
    const version = revision.current;
    try {
      const result = await prepareTransaction({
        publicClient: vaultClients[vault.id],
        vaultId: vault.id,
        owner,
        kind: mode,
        amount,
        all,
      });
      if (version === revision.current) setReview(result);
    } catch (error) {
      setMessage({ type: "error", text: friendlyTransactionError(error) });
    } finally {
      setBusy(false);
      actionLock.current = false;
      setStage("");
    }
  }
  async function submit(action) {
    if (actionLock.current || !review || uncertain || pending) return;
    if (
      review.kind !== mode ||
      review.vaultId !== vault.id ||
      review.owner.toLowerCase() !== owner.toLowerCase()
    ) {
      setReview(null);
      return;
    }
    if (activeSubmissions.has(uncertaintyKey)) {
      setMessage({
        type: "pending",
        text: "A wallet request is already in progress for this vault. Complete it in your wallet first.",
      });
      return;
    }
    try {
      if (localStorage.getItem(uncertaintyKey) === "1") {
        setUncertain(true);
        return;
      }
    } catch {
      /* In-memory lock still applies. */
    }
    activeSubmissions.add(uncertaintyKey);
    markUncertain(true);
    actionLock.current = true;
    setBusy(true);
    setMessage(null);
    setSentHash(null);
    setStage("Check your wallet to continue");
    let hash;
    let broadcastInput;
    let submittedAmount = tokenAmount(review.rawAmount);
    try {
      if (!sameWallet || !connector || !sameNetwork)
        throw Object.assign(
          new Error("Reconnect the signed-in wallet on " + vault.name + "."),
          { userFacing: true },
        );
      const provider = await connector.getProvider();
      const walletClient = createWalletClient({
        account: owner,
        chain: vault.chain,
        transport: custom(provider),
      });
      const record = (txHash, input, replacedHash) =>
        account.recordTransaction({
          hash: txHash,
          vaultId: vault.id,
          kind: action === "approve" ? "approve" : mode,
          amount: submittedAmount,
          amountEstimated: mode === "withdraw" && all,
          status: "pending",
          createdAt: Date.now(),
          input,
          replacedHash,
        });
      const result = await executeTransaction({
        publicClient: vaultClients[vault.id],
        walletClient,
        prepared: review,
        action,
        onHash: (txHash, context) => {
          hash = txHash;
          setSentHash(txHash);
          setStage("Submitted · waiting for confirmation");
          broadcastInput = context?.input || broadcastInput;
          if (context?.prepared)
            submittedAmount = tokenAmount(context.prepared.rawAmount);
          record(txHash, broadcastInput);
          const intendedInput = broadcastInput;
          vaultClients[vault.id]
            .getTransaction({ hash: txHash })
            .then((transaction) => {
              if (
                transaction.from.toLowerCase() === owner.toLowerCase() &&
                transaction.input.toLowerCase() === intendedInput?.toLowerCase()
              ) {
                account.recordTransaction({
                  hash: txHash,
                  vaultId: vault.id,
                  kind: action === "approve" ? "approve" : mode,
                  amount: submittedAmount,
                  status: "pending",
                  createdAt: Date.now(),
                  input: intendedInput,
                  nonce: transaction.nonce,
                });
              }
            })
            .catch(() => {});
          setUncertain(false);
          try {
            const saved = JSON.parse(
              localStorage.getItem(historyKey(owner)) || "null",
            );
            if (
              saved?.transactions?.some(
                (tx) => tx.hash === txHash.toLowerCase(),
              )
            )
              localStorage.removeItem(uncertaintyKey);
          } catch {
            /* Keep durable submission intent if the receipt could not be saved. */
          }
        },
        onReplacement: (info) => {
          const nextHash = info.transaction?.hash || info.hash;
          if (nextHash) {
            record(nextHash, broadcastInput, hash);
            hash = nextHash;
            setSentHash(nextHash);
          }
        },
      });
      hash = result.hash;
      submittedAmount = tokenAmount(
        result.actualAmount ?? result.prepared.rawAmount,
      );
      account.recordTransaction({
        hash,
        vaultId: vault.id,
        kind: action === "approve" ? "approve" : mode,
        amount: submittedAmount,
        amountEstimated:
          mode === "withdraw" && all && result.actualAmount == null,
        status: "success",
        createdAt: Date.now(),
        input: broadcastInput,
      });
      setMessage({
        type: "success",
        text:
          action === "approve"
            ? `${vault.symbol} approval confirmed. Review and confirm your deposit next.`
            : mode === "deposit"
              ? "Deposit confirmed onchain. Your position is refreshing."
              : `Withdrawal confirmed onchain. ${vault.symbol} has returned to your wallet.`,
      });
      setReview(null);
      if (action !== "approve") {
        setAmount("");
        setAll(false);
      }
      account.refresh();
    } catch (error) {
      hash = error.hash || hash;
      if (!hash) markUncertain(error.status === "pending");
      if (hash)
        account.recordTransaction({
          hash,
          vaultId: vault.id,
          kind: action === "approve" ? "approve" : mode,
          amount: submittedAmount,
          status:
            error.status === "reverted"
              ? "reverted"
              : error.status === "approval_missing"
                ? "success"
                : ["cancelled", "replaced"].includes(error.status)
                  ? "cancelled"
                  : "pending",
          createdAt: Date.now(),
          input: broadcastInput,
        });
      setMessage({
        type:
          hash && !["reverted", "cancelled", "replaced"].includes(error.status)
            ? "pending"
            : "error",
        text: hash
          ? error.userFacing
            ? error.message
            : "Confirmation is still pending. Check the transaction before trying again."
          : friendlyTransactionError(error),
      });
      setReview(null);
    } finally {
      setBusy(false);
      actionLock.current = false;
      setStage("");
      activeSubmissions.delete(uncertaintyKey);
    }
  }
  async function switchNetwork() {
    setMessage(null);
    try {
      await switchChainAsync({ chainId: vault.chainId });
    } catch {
      setMessage({
        type: "error",
        text:
          "Network switch was not completed. Select " +
          vault.name +
          " in your wallet to continue.",
      });
    }
  }
  return (
    <section
      className={p.transactionPanel}
      aria-label={"Manage your " + vault.symbol}
    >
      <div className={p.modeTabs} aria-label="Transaction type">
        {["deposit", "withdraw"].map((value) => (
          <button
            key={value}
            className={p.tab}
            aria-pressed={mode === value}
            disabled={busy || !!pending}
            onClick={() => setMode(value)}
          >
            {value === "deposit" ? "Deposit" : "Withdraw"}
          </button>
        ))}
      </div>
      <div>
        <h2>
          {mode === "deposit"
            ? `Deposit ${vault.symbol}`
            : "Back to your wallet."}
        </h2>
        <p className={p.sectionCopy}>
          {mode === "deposit"
            ? "Deposit into Thesauros on " + vault.name + "."
            : "Redeem your position on " + vault.name + "."}
        </p>
      </div>
      {needsFunds && !busy && !pending && !uncertain && !review ? (
        <div className={e.nextStep}>
          <span className={e.nextStepLabel}>Before you deposit</span>
          <h3>
            Add {vault.symbol} on {vault.name}.
          </h3>
          <p>
            Your wallet has {displayAmount(position.cash)} {vault.symbol} here.
            Add enough for the {tokenAmount(position.minAssets)} {vault.symbol}{" "}
            minimum, and keep {vault.gasToken} for network fees.
          </p>
          <button className={p.textButton} onClick={onSandbox}>
            Practise with test funds
          </button>
        </div>
      ) : noPosition && !busy && !pending ? (
        <div className={e.nextStep}>
          <h3>No Earn position on {vault.name}.</h3>
          <p>
            Once you deposit, you can withdraw part or all of that position
            here.
          </p>
          <button className={p.textButton} onClick={() => setMode("deposit")}>
            Make a deposit
          </button>
        </div>
      ) : (
        <div>
          <label className={p.formLabel} htmlFor="earn-amount">
            {mode === "deposit" ? "Deposit amount" : "Withdrawal amount"}
          </label>
          <div className={p.amountField}>
            <input
              className={p.amountInput}
              id="earn-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              onChange={(ev) => edit(ev.target.value)}
              disabled={busy || !!pending}
              aria-describedby={
                feedback
                  ? "earn-available earn-amount-feedback"
                  : "earn-available"
              }
              aria-invalid={!!feedback}
            />
            <span>{vault.symbol}</span>
          </div>
          <div id="earn-available" className={p.amountBalance}>
            <span>
              {mode === "deposit" ? "Available" : "Position value"}:{" "}
              {displayAmount(balance, 6)} {vault.symbol}
            </span>
            <button
              disabled={
                !ready || busy || !!pending || BigInt(balance || 0) === 0n
              }
              onClick={() => {
                setAmount(tokenAmount(balance));
                setAll(mode === "withdraw");
                setReview(null);
                setMessage(null);
              }}
            >
              {mode === "deposit" ? "Max" : "Withdraw all"}
            </button>
          </div>
          {feedback && (
            <p
              id="earn-amount-feedback"
              className={e.inputFeedback}
              role="status"
            >
              {feedback}
            </p>
          )}
        </div>
      )}
      <dl className={p.transactionDetails}>
        <div>
          <dt>Network</dt>
          <dd>{vault.name}</dd>
        </div>
        <div>
          <dt>{mode === "deposit" ? "Minimum deposit" : "Receiving wallet"}</dt>
          <dd>
            {mode === "deposit"
              ? displayAmount(ready ? position.minAssets : null) +
                " " +
                vault.symbol
              : short(owner)}
          </dd>
        </div>
        <div>
          <dt>Network fee</dt>
          <dd>Paid in {vault.gasToken}, shown in your wallet</dd>
        </div>
        {review && (
          <div>
            <dt>
              {mode === "deposit"
                ? "Estimated vault shares"
                : "Shares to redeem"}
            </dt>
            <dd>
              {displayAmount(review.shares, 6)}
              {all ? " · all shares" : ""}
            </dd>
          </div>
        )}
        <div>
          <dt>Vault</dt>
          <dd>
            <ExplorerLink vault={vault}>{short(vault.address)}</ExplorerLink>
          </dd>
        </div>
      </dl>
      {review && (
        <div className={e.review}>
          <span className={p.eyebrow}>Review your {mode}</span>
          <strong>
            {tokenAmount(review.rawAmount)} {vault.symbol}
          </strong>
          <p>
            {mode === "deposit"
              ? review.needsApproval
                ? `First approve exactly this amount of ${vault.symbol}. A separate wallet confirmation makes the deposit.`
                : `${vault.symbol} is approved. Confirm the deposit in your wallet to receive vault shares.`
              : all
                ? `Redeem all your vault shares. The final ${vault.symbol} amount is set when the transaction is included.`
                : `${vault.symbol} will return to the same wallet. The vault checks available liquidity when you confirm.`}
          </p>
          <p>
            Rates and share previews can change.{" "}
            {mode === "deposit" &&
              "This contract does not enforce a minimum share amount."}
          </p>
        </div>
      )}
      {paused && (
        <p className={p.stateMessage} role="status">
          {mode === "deposit" ? "Deposits" : "Withdrawals"} are currently paused
          for this vault.
        </p>
      )}
      {uncertain && !busy && (
        <div className={`${p.stateMessage} ${p.pending}`} role="status">
          <strong>Check your wallet activity.</strong>
          <p>
            Your wallet did not return a transaction hash. Confirm whether it
            sent the last request before trying again.
          </p>
          <p>
            <a
              href={vault.explorer + "/address/" + owner}
              target="_blank"
              rel="noreferrer"
            >
              Open account history
            </a>
          </p>
          <button className={p.textButton} onClick={() => markUncertain(false)}>
            I checked my wallet activity
          </button>
        </div>
      )}
      {account.historyError && (
        <p className={p.stateMessage} role="status">
          {account.historyError}
        </p>
      )}
      {pending && !busy && (
        <div className={`${p.stateMessage} ${p.pending}`} role="status">
          <strong>A transaction is awaiting confirmation.</strong>
          <ExplorerLink vault={vault} hash={pending.hash}>
            Check transaction
          </ExplorerLink>
          <p>
            Keep this vault clear of another request until its status is known.
          </p>
          <details className={e.conditions}>
            <summary>Replaced or cancelled in your wallet?</summary>
            <p>
              Paste the new transaction hash from your wallet. We check the
              account and transaction nonce before updating this request.
            </p>
            <label className={p.formLabel} htmlFor="replacement-hash">
              Replacement transaction hash
            </label>
            <input
              id="replacement-hash"
              className={e.hashInput}
              value={replacementHash}
              onChange={(event) => setReplacementHash(event.target.value)}
              autoComplete="off"
              placeholder="0x…"
            />
            <button
              className={p.textButton}
              disabled={resolving || !/^0x[\da-f]{64}$/i.test(replacementHash)}
              onClick={async () => {
                setResolving(true);
                setMessage(null);
                try {
                  const resolved = await account.resolveTransaction(
                    pending,
                    replacementHash,
                  );
                  setMessage({
                    type: "success",
                    text:
                      "Replacement verified. Your transaction status has been updated." +
                      (resolved.verificationNote
                        ? " " + resolved.verificationNote
                        : ""),
                  });
                  setReplacementHash("");
                } catch (error) {
                  setMessage({
                    type: "error",
                    text:
                      error.message ||
                      "Could not verify the replacement. Check your wallet activity.",
                  });
                } finally {
                  setResolving(false);
                }
              }}
            >
              {resolving ? "Verifying…" : "Verify replacement"}
            </button>
          </details>
        </div>
      )}
      {message && (
        <div
          className={`${p.stateMessage} ${p[message.type]}`}
          role={message.type === "error" ? "alert" : "status"}
        >
          {message.text}
          {sentHash && (
            <p>
              <ExplorerLink vault={vault} hash={sentHash}>
                View transaction
              </ExplorerLink>
            </p>
          )}
        </div>
      )}
      <div className={p.transactionFooter}>
        {needsFunds && !busy && !pending && !uncertain && !review ? (
          <button className={p.primaryButton} onClick={onFunding}>
            Add {vault.symbol} to your wallet
          </button>
        ) : noPosition && !busy && !pending ? (
          <button className={p.primaryButton} disabled>
            No position to withdraw
          </button>
        ) : !sameWallet ? (
          <button className={p.primaryButton} onClick={openConnectModal}>
            Reconnect wallet
          </button>
        ) : !sameNetwork ? (
          <button
            className={p.primaryButton}
            onClick={switchNetwork}
            disabled={busy}
          >
            Switch to {vault.name}
          </button>
        ) : busy ? (
          <button className={p.primaryButton} disabled>
            {stage}
          </button>
        ) : review ? (
          <>
            <button
              className={p.primaryButton}
              disabled={!!pending || paused || uncertain}
              onClick={() =>
                submit(
                  review.needsApproval && mode === "deposit"
                    ? "approve"
                    : "submit",
                )
              }
            >
              {review.needsApproval && mode === "deposit"
                ? `1. Approve ${vault.symbol}`
                : "Confirm " + mode}
            </button>
            <button className={p.textButton} onClick={() => setReview(null)}>
              Edit amount
            </button>
          </>
        ) : (
          <button
            className={p.primaryButton}
            disabled={
              !ready ||
              !amount ||
              !!pending ||
              paused ||
              uncertain ||
              !!feedback
            }
            onClick={reviewAmount}
          >
            Review {mode}
          </button>
        )}
        <p className={p.dataNote}>
          Real {vault.symbol} on {vault.name}. Every transfer needs your wallet
          confirmation.
        </p>
      </div>
      <details className={e.conditions}>
        <summary>What to know before depositing</summary>
        <p>
          Your funds are exposed to lending-market and smart-contract risk.
          Vault administrators can upgrade the implementation, change fees and
          pause deposits or withdrawals. Withdrawals depend on available
          liquidity.
        </p>
        <a href={documentationHref("/security/controls/")}>
          Read about vault controls
        </a>
      </details>
    </section>
  );
}

function TransactionList({
  transactions,
  emptyAction,
  emptyActionLabel = "Practise in Sandbox first",
}) {
  if (!transactions.length)
    return (
      <div className={p.emptyState}>
        <span className={p.emptyIcon}>
          <Icon type="history" />
        </span>
        <div>
          <h3>Your next move will appear here.</h3>
          <p>
            Deposits, withdrawals and approvals made from this browser, with a
            link to each onchain receipt.
          </p>
          {emptyAction && (
            <button className={p.textButton} onClick={emptyAction}>
              {emptyActionLabel}
            </button>
          )}
        </div>
      </div>
    );
  return (
    <div className={p.positionList}>
      {transactions.map((tx) => {
        const vault = getVault(tx.vaultId);
        return (
          <div key={tx.hash} className={p.positionRow}>
            <div className={p.positionIdentity}>
              <img
                className={p.tokenIcon}
                src="/brand/tokens/usdc.svg"
                width="40"
                height="40"
                alt=""
              />
              <div>
                <strong>
                  {tx.kind === "approve"
                    ? `${vault.symbol} approval`
                    : tx.kind === "withdraw"
                      ? "Withdrawal"
                      : "Deposit"}
                </strong>
                <small>
                  {vault.name} ·{" "}
                  {new Date(tx.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}
                </small>
                <ExplorerLink
                  vault={vault}
                  hash={tx.replacementHash || tx.hash}
                >
                  {tx.replacementHash ? "View replacement" : "View receipt"}
                </ExplorerLink>
              </div>
            </div>
            <div className={p.positionValue}>
              <strong>
                {tx.amountEstimated ? "≈ " : ""}
                {tx.amount} {vault.symbol}
              </strong>
              {tx.amountEstimated && <small>Estimated amount</small>}
              <span className={e[tx.status]}>
                {tx.status === "success"
                  ? "Confirmed"
                  : tx.status === "reverted"
                    ? "Reverted"
                    : tx.status === "cancelled"
                      ? "Replaced / cancelled"
                      : "Awaiting confirmation"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
export function Transactions({ account, navigate }) {
  return (
    <div className={p.product}>
      <div className={p.guideRail}>
        <div className={p.guideText}>
          <Icon type="history" />
          <div>
            <strong>Your activity, with receipts.</strong>
            <span>
              Transactions initiated in this browser. Explore your address for a
              complete onchain history.
            </span>
          </div>
        </div>
      </div>
      {account.historyError && (
        <p className={p.stateMessage} role="status">
          {account.historyError}
        </p>
      )}
      <TransactionList
        transactions={account.transactions}
        emptyAction={() => navigate("overview")}
        emptyActionLabel="Open Earn"
      />
      <div className={p.headerActions}>
        {vaults.map((v) => (
          <a
            className={p.secondaryButton}
            key={v.id}
            href={v.explorer + "/address/" + account.owner}
            target="_blank"
            rel="noreferrer"
          >
            {v.name} account history
          </a>
        ))}
      </div>
    </div>
  );
}
