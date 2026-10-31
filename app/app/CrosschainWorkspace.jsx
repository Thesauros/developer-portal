"use client";
import { useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { createWalletClient, custom, formatUnits } from "viem";
import { base } from "viem/chains";
import {
  crosschain,
  assertCrosschainIdentity,
  sameAddress,
} from "../../lib/crosschain-config.mjs";
import {
  crosschainAmount,
  executeCrosschain,
  receiptShowsCall,
  verifyCrosschainReceipt,
} from "../../lib/crosschain-transactions.mjs";
import { vaultClients } from "../../lib/vault-rpc.mjs";
import { receiptRequestIds } from "../../lib/crosschain-reads.mjs";
import { loadCrosschainFeed } from "../../lib/crosschain-feed.mjs";
import CrosschainPanels, {
  ContractDetails,
  ExitAndTerms,
  CrosschainStatus,
  EarlyNotice,
  RequestList,
  usdc,
} from "./CrosschainPanels";
import s from "./crosschain.module.css";

async function read(resource) {
  const response = await fetch("/api/crosschain/" + resource, {
    cache: "no-store",
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "Cross-chain data is unavailable.");
  return value;
}
const locks = new Set();

export default function CrosschainWorkspace({
  user,
  view = "overview",
  navigate = () => {},
  otherVaults = 0,
}) {
  const owner = user.walletAddress;
  const walletAccount = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [feed, setFeed] = useState(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [amount, setAmount] = useState(""),
    [action, setAction] = useState("deposit");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [succeeded, setSucceeded] = useState(false);
  const [pending, setPending] = useState(null),
    [recoveryHash, setRecoveryHash] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [requestIds, setRequestIds] = useState([]),
    [manualId, setManualId] = useState("");
  const key =
    "thesauros.crosschain." +
    crosschain.vault.toLowerCase() +
    "." +
    owner?.toLowerCase();
  const client = vaultClients.base;
  const refresh = () => setRevision((value) => value + 1);

  useEffect(() => {
    setStorageReady(false);
    try {
      const saved = localStorage.getItem(key);
      setPending(saved ? JSON.parse(saved) : null);
      setRequestIds(
        JSON.parse(localStorage.getItem(key + ".requests") || "[]")
          .filter((id) => /^\d{1,78}$/.test(id))
          .slice(-20),
      );
      setStorageReady(true);
    } catch {
      setError("Allow browser storage before submitting a transaction.");
    }
  }, [key]);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const value = await loadCrosschainFeed(owner, requestIds, read);
        if (value.vault) assertCrosschainIdentity(value.vault);
        if (!active) return;
        setFeed(value);
        setError("");
      } catch (failure) {
        if (active) {
          setFeed(null);
          setError(failure.message);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    setLoading(true);
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [revision, owner, requestIds.join(",")]);

  function trackIds(ids) {
    const combined = [...new Set([...requestIds, ...ids])].slice(-20);
    localStorage.setItem(key + ".requests", JSON.stringify(combined));
    setRequestIds(combined);
  }
  async function trackManualRequest(event) {
    event.preventDefault();
    if (!/^(?:0|[1-9]\d{0,77})$/.test(manualId)) {
      setMessage("Enter a valid unsigned request ID.");
      return;
    }
    try {
      await read("user?requests=" + manualId);
      trackIds([manualId]);
      setManualId("");
    } catch (failure) {
      setMessage(failure.message);
    }
  }

  function savePending(value) {
    // A storage failure must stop signing; otherwise a reload could duplicate a request.
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
    setPending(value);
  }
  async function submit(kind, input) {
    if (locks.has(key) || pending || !storageReady) return;
    if (localStorage.getItem(key)) {
      setPending(JSON.parse(localStorage.getItem(key)));
      return;
    }
    locks.add(key);
    setBusy(true);
    setMessage("");
    setSucceeded(false);
    let signing = false;
    try {
      if (!owner || !sameAddress(walletAccount.address, owner))
        throw new Error("Connect the wallet you used to sign in.");
      const vault = await read("vault");
      assertCrosschainIdentity(vault);
      if (["approve", "deposit", "redeem"].includes(kind))
        await Promise.all([
          read("health"),
          read("backend-base"),
          read("backend-arbitrum"),
        ]);
      if (
        ["approve", "deposit", "redeem"].includes(kind) &&
        (vault.tick?.frozen !== false ||
          vault.tick?.quarantined !== false ||
          !Number.isFinite(vault.tick?.ageSeconds) ||
          vault.tick.ageSeconds < 0 ||
          !Number.isFinite(vault.risk?.maxTickAge) ||
          vault.tick.ageSeconds > vault.risk.maxTickAge)
      )
        throw new Error(
          "New requests are unavailable until the vault has a fresh accepted valuation.",
        );
      if (walletAccount.chainId !== crosschain.chainId)
        await switchChainAsync({ chainId: crosschain.chainId });
      const provider = await walletAccount.connector.getProvider({
        chainId: crosschain.chainId,
      });
      const wallet = createWalletClient({
        chain: base,
        transport: custom(provider),
      });
      const receipt = await executeCrosschain(
        client,
        wallet,
        owner,
        kind,
        input,
        (hash, address) => {
          const saved = JSON.parse(localStorage.getItem(key));
          savePending({ ...saved, hash, address });
          setMessage("Submitted. Waiting for confirmation on Base…");
        },
        (intent) => {
          savePending({ ...intent, kind, owner, chainId: crosschain.chainId });
          signing = true;
          setMessage("Confirm the operation in your wallet.");
        },
      );
      trackIds(receiptRequestIds(receipt, owner));
      savePending(null);
      setMessage(
        {
          approve: "Approval confirmed. Now request the deposit.",
          deposit: "Deposit requested. It joins the current batch.",
          redeem: "Withdrawal requested. Your shares join the current batch.",
          claim: "Claimed. Your balance is updating.",
          cancel: "Request cancelled.",
        }[kind],
      );
      setSucceeded(true);
      if (kind === "deposit" || kind === "redeem") setAmount("");
      refresh();
    } catch (failure) {
      const rejected =
        failure.walk?.((e) => e.code === 4001) ||
        /User rejected|UserRejected|denied.*request/i.test(failure.message);
      if (signing && rejected) savePending(null);
      setMessage(
        signing && !rejected
          ? "Submission status is unresolved. Check your wallet and recover the transaction below before continuing."
          : failure.shortMessage || failure.message,
      );
    } finally {
      locks.delete(key);
      setBusy(false);
    }
  }
  async function recover() {
    if (busy || locks.has(key)) return;
    const hash = pending?.hash || recoveryHash;
    if (!/^0x[0-9a-f]{64}$/i.test(hash || "")) {
      setMessage("Enter the transaction hash from your wallet.");
      return;
    }
    locks.add(key);
    setBusy(true);
    try {
      if (
        !sameAddress(pending.owner, owner) ||
        pending.chainId !== crosschain.chainId ||
        ![crosschain.vault, crosschain.asset].some((address) =>
          sameAddress(address, pending.address),
        )
      )
        throw new Error(
          "Saved operation does not match this wallet and stand.",
        );
      const [receipt, transaction, chainId] = await Promise.all([
        client.getTransactionReceipt({ hash }),
        client.getTransaction({ hash }),
        client.getChainId(),
      ]);
      // A wallet relay changes the sender and target; the events still show the call.
      if (
        chainId === crosschain.chainId &&
        receipt.transactionHash.toLowerCase() === hash.toLowerCase() &&
        receiptShowsCall(receipt, owner, pending.address, pending.data)
      ) {
        trackIds(receiptRequestIds(receipt, owner));
        savePending(null);
        setMessage("Transaction confirmed on Base.");
        refresh();
        return;
      }
      if (
        chainId !== crosschain.chainId ||
        !sameAddress(transaction.from, owner) ||
        !sameAddress(transaction.to, pending.address) ||
        transaction.input?.toLowerCase() !== pending.data?.toLowerCase()
      )
        throw new Error("This transaction does not match the saved operation.");
      if (receipt.status === "reverted") {
        if (
          !sameAddress(receipt.from, owner) ||
          !sameAddress(receipt.to, pending.address) ||
          receipt.transactionHash.toLowerCase() !== hash.toLowerCase()
        )
          throw new Error("Receipt identity does not match.");
        savePending(null);
        setMessage(
          "The transaction reverted. You can prepare a new operation.",
        );
      } else {
        verifyCrosschainReceipt(receipt, hash, owner, pending.address);
        trackIds(receiptRequestIds(receipt, owner));
        savePending(null);
        setMessage("Transaction confirmed on Base.");
      }
      refresh();
    } catch {
      setMessage(
        "The matching transaction is not confirmed. Check your wallet or explorer before retrying recovery.",
      );
    } finally {
      locks.delete(key);
      setBusy(false);
    }
  }
  const vault = feed?.vault;
  const blocked =
    busy || !!pending || !storageReady || !feed?.vault || !feed?.user || !owner;
  const newRequestsBlocked = blocked || !!feed?.backendError;
  const bar = (
    <div className={s.bar}>
      <EarlyNotice vault={vault} />
      <button onClick={refresh} disabled={loading}>
        {loading ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
  const unresolved = pending && (
    <div className={s.notice} role="status">
      <p>
        A transaction is still unconfirmed. New actions stay locked until it is
        checked.
      </p>
      {view === "earn" ? (
        <div className={s.actions}>
          {pending.hash ? (
            <a
              href={crosschain.explorer + "/tx/" + pending.hash}
              target="_blank"
              rel="noreferrer"
            >
              View transaction ↗
            </a>
          ) : (
            <label className={s.field}>
              Transaction hash from your wallet
              <input
                value={recoveryHash}
                onChange={(event) => setRecoveryHash(event.target.value)}
              />
            </label>
          )}
          <button onClick={recover} disabled={busy}>
            Check confirmation
          </button>
        </div>
      ) : (
        <button onClick={() => navigate("earn")}>Check it</button>
      )}
    </div>
  );
  if (view !== "earn")
    return (
      <div className={s.workspace}>
        {bar}
        <CrosschainStatus feed={feed} loading={loading} />
        {unresolved}
        {message && (
          <p role="status" className={succeeded ? s.success : s.notice}>
            {message}
          </p>
        )}
        <CrosschainPanels
          view={view}
          feed={feed}
          onStart={(next) => {
            setAction(next);
            setAmount("");
            navigate("earn");
          }}
          onClaim={(id) => submit("claim", id)}
          onCancel={(id) => submit("cancel", id)}
          blocked={blocked}
          owner={owner}
          navigate={navigate}
          otherVaults={otherVaults}
        />
      </div>
    );
  const deposit = action === "deposit";
  const available = deposit ? feed?.user?.cash : feed?.user?.shares;
  let parsed = null;
  try {
    if (amount) parsed = crosschainAmount(amount);
  } catch {
    parsed = null;
  }
  const allowance = /^\d+$/.test(String(feed?.user?.allowance ?? ""))
    ? BigInt(feed.user.allowance)
    : 0n;
  const needsApproval = deposit && parsed != null && allowance < parsed;
  const minimum = vault?.limits?.minDeposit;
  const problem = !amount
    ? ""
    : parsed == null
      ? "Enter an amount with up to 6 decimal places."
      : /^\d+$/.test(String(available ?? "")) && parsed > BigInt(available)
        ? deposit
          ? "That is more than the USDC in your wallet on Base."
          : "That is more than the shares you hold."
        : deposit && minimum && parsed < BigInt(minimum)
          ? `The minimum deposit is ${usdc(minimum)} USDC.`
          : "";
  const price = vault?.tick?.rateBid;
  const estimate =
    !deposit && parsed != null && /^\d+$/.test(String(price ?? ""))
      ? String((parsed * BigInt(price)) / 10n ** 18n)
      : null;
  const noGas =
    /^\d+$/.test(String(feed?.user?.eth ?? "")) && BigInt(feed.user.eth) === 0n;
  const ownRequests = feed?.user?.requests || [];
  return (
    <div className={s.workspace}>
      {bar}
      {error && (
        <p className={s.notice} role="alert" title={error}>
          The vault's data could not load, so new requests are unavailable. Your
          funds are not affected. Try Refresh.
        </p>
      )}
      <CrosschainStatus feed={feed} loading={loading} />
      {unresolved}
      <div className={s.columns}>
        <section className={s.card} aria-label="Deposit or withdraw">
          <div className={s.segmented} role="group" aria-label="Action">
            {[
              ["deposit", "Deposit"],
              ["redeem", "Withdraw"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={action === value}
                disabled={busy}
                onClick={() => {
                  setAction(value);
                  setAmount("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <form
            className={s.form}
            onSubmit={(event) => {
              event.preventDefault();
              submit(needsApproval ? "approve" : action, amount);
            }}
          >
            <label className={s.field}>
              {deposit ? "Amount" : "Shares to withdraw"}
              <span className={s.amount}>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  disabled={busy}
                  required
                />
                {deposit ? "USDC" : "shares"}
                <button
                  type="button"
                  disabled={
                    busy ||
                    !/^\d+$/.test(String(available ?? "")) ||
                    available === "0"
                  }
                  onClick={() => setAmount(formatUnits(BigInt(available), 6))}
                >
                  Max
                </button>
              </span>
            </label>
            <p className={problem ? s.hintBad : s.hint} role="status">
              {problem ||
                (estimate
                  ? `About ${usdc(estimate)} USDC at the current share price. The final amount is set when the batch settles.`
                  : deposit
                    ? `${usdc(available)} USDC in your wallet on Base.`
                    : `You hold ${usdc(available, 4)} shares.`)}
            </p>
            <ol className={s.plan}>
              {deposit && (
                <li>
                  Approve this exact amount
                  {parsed != null && !needsApproval ? " (done)" : ""}.
                </li>
              )}
              <li>
                {deposit
                  ? "Request the deposit. It joins the current batch."
                  : "Request the withdrawal. Your shares join the current batch."}
              </li>
              <li>
                When the batch settles, claim your {deposit ? "shares" : "USDC"}
                .
              </li>
            </ol>
            <button
              type="submit"
              className={s.primary}
              disabled={newRequestsBlocked || !parsed || !!problem}
            >
              {busy
                ? "Check your wallet…"
                : needsApproval
                  ? `Approve ${usdc(String(parsed))} USDC`
                  : deposit
                    ? "Request deposit"
                    : "Request withdrawal"}
            </button>
          </form>
          {noGas && (
            <p className={s.hintBad}>
              You have no ETH on Base. Some wallets can pay network fees in
              USDC; otherwise add a little ETH first.
            </p>
          )}
          {!owner && <p>Sign in with a wallet to manage requests.</p>}
          {message && (
            <p role="status" className={succeeded ? s.success : s.notice}>
              {message}
            </p>
          )}
        </section>
        <section className={s.card} aria-label="Your requests">
          <h3>Your requests</h3>
          {!feed?.user ? (
            <p className={s.muted}>
              Your requests could not be read right now.
            </p>
          ) : !ownRequests.length ? (
            <p className={s.muted}>
              {feed.user.coverage?.complete
                ? "Nothing yet. A request you make appears here until you claim it."
                : "Nothing found yet. History is still being read from Base."}
            </p>
          ) : (
            <RequestList
              requests={ownRequests}
              price={price}
              onClaim={(id) => submit("claim", id)}
              onCancel={(id) => submit("cancel", id)}
              blocked={blocked}
              owner={owner}
            />
          )}
          <details className={s.details}>
            <summary>Can't see a request?</summary>
            <form className={s.form} onSubmit={trackManualRequest}>
              <label className={s.field}>
                Request ID from your transaction
                <span className={s.amount}>
                  <input
                    value={manualId}
                    inputMode="numeric"
                    onChange={(event) => setManualId(event.target.value)}
                  />
                  <button disabled={!owner || !manualId || busy}>Add</button>
                </span>
              </label>
            </form>
          </details>
        </section>
      </div>
      <ExitAndTerms vault={vault} allocation={feed?.allocation} />
      <ContractDetails vault={vault} allocation={feed?.allocation} />
    </div>
  );
}
