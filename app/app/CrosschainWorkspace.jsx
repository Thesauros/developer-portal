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
  executeCrosschain,
  verifyCrosschainReceipt,
} from "../../lib/crosschain-transactions.mjs";
import { vaultClients } from "../../lib/vault-rpc.mjs";
import { receiptRequestIds } from "../../lib/crosschain-reads.mjs";
import {
  loadCrosschainFeed,
  mergeTrackedRequestIds,
} from "../../lib/crosschain-feed.mjs";
import { migrationKey, parseMigration } from "../../lib/migration-state.mjs";
import { retryMigrationIntent } from "../../lib/migration-retry.mjs";
import { migrationDestination } from "../../lib/migration-destination.mjs";
import CrosschainPanels, {
  CrosschainStatus,
  amount as displayUnits,
} from "./CrosschainPanels";
import s from "./crosschain.module.css";
import VaultTransactionRecovery from "./VaultTransactionRecovery";

const short = (value) => value.slice(0, 6) + "…" + value.slice(-4);
const units = (value) => {
  if (!/^\d+$/.test(String(value ?? ""))) return "—";
  return formatUnits(BigInt(value), 6);
};
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
  migrationBlocked = false,
  migrationRequestIds = [],
  recoveryTransactions = [],
  recoveryBusy = false,
  recoveryLoading = false,
  recoveryStorageError = "",
  legacyChecking = false,
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
    [message, setMessage] = useState("");
  const [pending, setPending] = useState(null),
    [recoveryHash, setRecoveryHash] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [requestIds, setRequestIds] = useState([]);
  const key =
    "thesauros.crosschain." +
    crosschain.vault.toLowerCase() +
    "." +
    owner?.toLowerCase();
  const client = vaultClients.base;
  const refresh = () => setRevision((value) => value + 1);
  const trackedIds = mergeTrackedRequestIds(migrationRequestIds, requestIds);
  const recoveryPanel = (
    <VaultTransactionRecovery
      transactions={recoveryTransactions}
      busy={busy || recoveryBusy}
      loading={recoveryLoading}
      storageError={recoveryStorageError}
    />
  );

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
        const value = await loadCrosschainFeed(owner, trackedIds, read);
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
  }, [revision, owner, trackedIds.join(",")]);

  function trackIds(ids) {
    const combined = [...new Set([...requestIds, ...ids])].slice(-20);
    localStorage.setItem(key + ".requests", JSON.stringify(combined));
    setRequestIds(combined);
  }
  function savePending(value) {
    // A storage failure must stop signing; otherwise a reload could duplicate a request.
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
    setPending(value);
  }
  async function submit(kind, input) {
    if (!owner || !navigator.locks) {
      setMessage(
        "Use a current browser with Web Locks support to sign transactions safely.",
      );
      return;
    }
    await navigator.locks.request(
      migrationKey(owner),
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          setMessage("Another tab is preparing a wallet transaction.");
          return;
        }
        try {
          const saved = parseMigration(
            localStorage.getItem(migrationKey(owner)),
            owner,
          );
          if (Object.values(saved.products).some((record) => record.pending))
            throw new Error(
              "Check the unresolved migration transaction before signing another operation.",
            );
          if (
            migrationBlocked &&
            ["approve", "deposit", "redeem"].includes(kind)
          )
            throw new Error(
              "Continue your migration above before preparing a new request.",
            );
          await submitUnlocked(kind, input);
        } catch (failure) {
          setMessage(failure.message);
        }
      },
    );
  }
  async function submitUnlocked(kind, input) {
    if (locks.has(key) || pending || !storageReady) return;
    if (localStorage.getItem(key)) {
      setPending(JSON.parse(localStorage.getItem(key)));
      return;
    }
    locks.add(key);
    setBusy(true);
    setMessage("");
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
        kind === "approve"
          ? "Approval confirmed. Request the deposit when ready."
          : "Transaction confirmed on Base. Balances and request state are read directly from the contracts.",
      );
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
  async function retrySaved() {
    if (!owner || busy || !pending || !navigator.locks) return;
    await navigator.locks.request(
      migrationKey(owner),
      { ifAvailable: true },
      async (lock) => {
        if (!lock) return;
        setBusy(true);
        try {
          if (!sameAddress(pending.owner, owner) || pending.chainId !== 8453)
            throw new Error("Saved account or chain does not match.");
          const migrations = parseMigration(
            localStorage.getItem(migrationKey(owner)),
            owner,
          );
          if (
            Object.values(migrations.products).some((record) => record.pending)
          )
            throw new Error("Check the pending migration first.");
          if (walletAccount.chainId !== 8453)
            await switchChainAsync({ chainId: 8453 });
          const provider = await walletAccount.connector.getProvider({
            chainId: 8453,
          });
          const wallet = createWalletClient({
            chain: base,
            transport: custom(provider),
          });
          const result = await retryMigrationIntent({
            publicClient: client,
            walletClient: wallet,
            owner,
            vaultId: "base",
            pending,
            beforeRetry: (kind) =>
              ["claim", "cancel"].includes(kind)
                ? Promise.resolve()
                : migrationDestination.check(kind),
            onHash: (hash) => savePending({ ...pending, hash }),
          });
          setRecoveryHash(result.hash);
          setMessage(
            "The same operation was submitted with the saved nonce. Check confirmation below; it can execute only once.",
          );
        } catch (failure) {
          setMessage(
            failure.code === "NONCE_CONSUMED"
              ? "This nonce has been used. Enter the confirmed transaction or replacement hash below."
              : "The saved operation remains unresolved. You can retry the same wallet request or check its transaction hash.",
          );
        } finally {
          setBusy(false);
          refresh();
        }
      },
    );
  }
  async function recover() {
    if (busy || locks.has(key)) return;
    const hash = recoveryHash || pending?.hash;
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
      const transaction = await client.getTransaction({ hash });
      let nonce = pending.nonce;
      if (
        pending.hash?.toLowerCase() === hash.toLowerCase() &&
        sameAddress(transaction.from, owner) &&
        sameAddress(transaction.to, pending.address) &&
        transaction.input?.toLowerCase() === pending.data?.toLowerCase() &&
        Number.isSafeInteger(transaction.nonce)
      ) {
        nonce = transaction.nonce;
        savePending({ ...pending, nonce });
      }
      const [receipt, chainId, head] = await Promise.all([
        client.getTransactionReceipt({ hash }),
        client.getChainId(),
        client.getBlockNumber({ cacheTime: 0 }),
      ]);
      if (
        chainId !== crosschain.chainId ||
        transaction.hash?.toLowerCase() !== hash.toLowerCase() ||
        !sameAddress(transaction.from, owner) ||
        !sameAddress(receipt.from, owner) ||
        (transaction.to == null
          ? receipt.to != null
          : !sameAddress(receipt.to, transaction.to)) ||
        receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() ||
        !["success", "reverted"].includes(receipt.status) ||
        receipt.blockNumber == null ||
        transaction.blockNumber !== receipt.blockNumber ||
        head < receipt.blockNumber ||
        transaction.blockHash?.toLowerCase() !==
          receipt.blockHash?.toLowerCase() ||
        !Number.isSafeInteger(nonce) ||
        nonce !== transaction.nonce
      )
        throw new Error("This transaction does not match the saved operation.");
      if (
        !sameAddress(transaction.to, pending.address) ||
        transaction.value !== 0n ||
        transaction.input?.toLowerCase() !== pending.data?.toLowerCase()
      ) {
        savePending(null);
        setMessage(
          "The operation was cancelled or replaced by another confirmed transaction. Balances will be read again.",
        );
        refresh();
        return;
      }
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
    busy ||
    !!pending ||
    !storageReady ||
    !feed?.vault ||
    !feed?.user ||
    !owner ||
    migrationBlocked;
  const newRequestsBlocked =
    blocked || !!feed?.backendError || migrationBlocked;
  const available =
    action === "deposit" ? feed?.user?.cash : feed?.user?.shares;
  const canSelectMax =
    /^\d+$/.test(String(available ?? "")) && BigInt(available) > 0n;
  const legacyCheckStatus = legacyChecking ? (
    <p className={s.muted} role="status">
      Checking legacy vault positions…
    </p>
  ) : null;
  if (view !== "earn")
    return (
      <div className={s.workspace}>
        <div className={s.intro}>
          <span className={s.badge}>Cross-chain stand · Base + Arbitrum</span>
          <button onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <CrosschainStatus feed={feed} loading={loading} />
        {recoveryPanel}
        {legacyCheckStatus}
        <CrosschainPanels
          view={view}
          feed={feed}
          loading={loading}
          navigate={navigate}
        />
        {pending && (
          <p className={s.notice}>
            A wallet submission is unresolved.{" "}
            <button onClick={() => navigate("earn")}>
              Check its confirmation
            </button>
          </p>
        )}
      </div>
    );
  return (
    <div className={s.workspace}>
      <section className={s.intro}>
        <div>
          <span className={s.badge}>Cross-chain stand · Base + Arbitrum</span>
          <h2>One vault, two networks</h2>
          <p>
            Deposit USDC on Base. Capital can earn on Base and Arbitrum.
            Deposits and withdrawals settle through an epoch queue, followed by
            a claim.
          </p>
          <a
            href={crosschain.explorer + "/address/" + crosschain.vault}
            target="_blank"
            rel="noreferrer"
          >
            EpochVault {short(crosschain.vault)} ↗
          </a>
        </div>
        <button onClick={refresh} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </section>
      {error && (
        <p className={s.notice} role="alert">
          {error} Financial data and new requests are unavailable. Refresh after
          the service recovers.
        </p>
      )}
      <CrosschainStatus feed={feed} loading={loading} />
      {recoveryPanel}
      {legacyCheckStatus}
      <section className={s.metrics} aria-label="Cross-chain vault state">
        <article>
          <span>USDC in your Base wallet</span>
          <strong>{units(feed?.user?.cash)}</strong>
        </article>
        <article>
          <span>Current USDC allowance</span>
          <strong>{units(feed?.user?.allowance)}</strong>
        </article>
        <article>
          <span>Your shares</span>
          <strong>{units(feed?.user?.shares)}</strong>
        </article>
        <article>
          <span>ETH for gas on Base</span>
          <strong>{displayUnits(feed?.user?.eth, 18)}</strong>
        </article>
      </section>
      {vault && (
        <p className={s.muted}>
          Epoch can close from{" "}
          {new Date(vault.epoch.earliestCloseAt * 1000).toLocaleString()} and by{" "}
          {new Date(vault.epoch.latestCloseAt * 1000).toLocaleString()}.
          Settlement and liquidity funding may take longer. Valuation{" "}
          {vault.tick.frozen
            ? "frozen"
            : vault.tick.quarantined
              ? "quarantined"
              : "accepted"}
          ; age {vault.tick.ageSeconds ?? "unknown"} seconds.
        </p>
      )}
      <div className={s.columns}>
        <section className={s.card}>
          <h3>Request a deposit or withdrawal</h3>
          {migrationBlocked && (
            <p className={s.notice}>
              A wallet operation is unresolved. Check its confirmation above
              before preparing another operation.
            </p>
          )}
          <p>
            All operations are signed by your wallet on Base. Approval does not
            create a deposit.
          </p>
          <p>
            Minimum deposit: {units(vault?.limits?.minDeposit)} USDC. Available:{" "}
            {action === "deposit"
              ? units(feed?.user?.cash) + " USDC"
              : units(feed?.user?.shares) + " vault shares"}
            .
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit(action, amount);
            }}
          >
            <label>
              Operation
              <select
                value={action}
                onChange={(event) => setAction(event.target.value)}
                disabled={busy}
              >
                <option value="deposit">Deposit USDC</option>
                <option value="redeem">Withdraw vault shares</option>
              </select>
            </label>
            <label>
              {action === "deposit"
                ? "USDC amount"
                : "Share amount (6 decimals)"}
              <input
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                disabled={busy}
                required
              />
            </label>
            <div className={s.actions}>
              <button
                type="button"
                disabled={busy || !canSelectMax}
                onClick={() => setAmount(units(available))}
              >
                Max
              </button>
              {action === "deposit" && (
                <button
                  type="button"
                  disabled={newRequestsBlocked || !amount}
                  onClick={() => submit("approve", amount)}
                >
                  Approve exact USDC
                </button>
              )}
              <button type="submit" disabled={newRequestsBlocked || !amount}>
                Request {action === "deposit" ? "deposit" : "withdrawal"}
              </button>
            </div>
          </form>
          {!owner && <p>Sign in with a wallet to manage requests.</p>}
          {pending && (
            <div className={s.notice}>
              <p>
                A submission is unresolved. New operations are locked until its
                receipt is checked.
              </p>
              {pending.hash && (
                <a
                  href={crosschain.explorer + "/tx/" + pending.hash}
                  target="_blank"
                  rel="noreferrer"
                >
                  View submitted transaction ↗
                </a>
              )}
              <label>
                Transaction hash or replacement hash from your wallet
                <input
                  value={recoveryHash}
                  onChange={(event) => setRecoveryHash(event.target.value)}
                />
              </label>
              <button onClick={recover} disabled={busy}>
                Check confirmation
              </button>
              {Number.isSafeInteger(pending.nonce) && (
                <>
                  <p>
                    If you reloaded while the signature prompt was open, reopen
                    the saved request. The same nonce prevents a second
                    execution.
                  </p>
                  <button onClick={retrySaved} disabled={busy}>
                    Retry the same wallet request
                  </button>
                </>
              )}
            </div>
          )}
          {message && (
            <p role="status" className={s.notice}>
              {message}
            </p>
          )}
        </section>
        <section className={s.card}>
          <h3>Capital across networks</h3>
          {crosschain.networks.map((network) => {
            const allocation = feed?.allocation?.chains?.find(
              (chain) => chain.chainId === network.chainId,
            );
            return (
              <article className={s.network} key={network.chainId}>
                <h4>
                  {network.name} · {network.role === "hub" ? "Hub" : "Spoke"}
                </h4>
                <p>
                  Strategy: {units(allocation?.strategyValue)} USDC · Idle:{" "}
                  {units(allocation?.idle)} USDC
                </p>
                <a
                  href={network.explorer + "/address/" + network.agent}
                  target="_blank"
                  rel="noreferrer"
                >
                  ChainAgent {short(network.agent)} ↗
                </a>
                <a
                  href={network.explorer + "/address/" + network.strategy}
                  target="_blank"
                  rel="noreferrer"
                >
                  Strategy {short(network.strategy)} ↗
                </a>
              </article>
            );
          })}
          <p className={s.muted}>
            Capital in transit:{" "}
            {feed?.allocation ? (feed.allocation.inFlight?.length ?? "—") : "—"}{" "}
            transfers.
          </p>
        </section>
      </div>
      <section className={s.card}>
        <h3>Your epoch requests</h3>
        <p>
          Your deposit and withdrawal requests appear here automatically.
          {feed?.user?.coverage &&
            !feed.user.coverage.complete &&
            " Recent requests may take a moment to appear."}
        </p>
        {!feed?.user ? (
          <p>Account requests are unavailable.</p>
        ) : !feed.user.requests?.length ? (
          <p>
            {feed?.user?.coverage?.complete
              ? "No EpochVault requests found for this wallet."
              : "No requests found yet. Event indexing is in progress."}
          </p>
        ) : (
          <div className={s.requests}>
            {feed.user.requests.map((request) => (
              <article className={s.network} key={request.id}>
                <h4>
                  {request.kind === "deposit" ? "Deposit" : "Withdrawal"} ·
                  Epoch {request.epoch}
                </h4>
                <p>
                  {units(request.amount)}{" "}
                  {request.kind === "deposit" ? "USDC" : "shares"} ·{" "}
                  {String(request.state).replaceAll("_", " ")}
                </p>
                <div className={s.actions}>
                  {request.state === "claimable" && (
                    <button
                      disabled={blocked}
                      onClick={() => submit("claim", request.id)}
                    >
                      Claim
                    </button>
                  )}
                  {request.cancellable && sameAddress(request.owner, owner) && (
                    <button
                      disabled={blocked}
                      onClick={() => submit("cancel", request.id)}
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
                      View request ↗
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
