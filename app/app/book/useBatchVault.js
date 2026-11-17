"use client";
import { useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { createWalletClient, custom } from "viem";
import { chainByChainId } from "../../../lib/chains.mjs";
import {
  crosschain,
  assertCrosschainIdentity,
  sameAddress,
} from "../../../lib/crosschain-config.mjs";
import {
  executeCrosschain,
  receiptShowsCall,
  verifyCrosschainReceipt,
} from "../../../lib/crosschain-transactions.mjs";
import { vaultClients } from "../../../lib/vault-rpc.mjs";
import { receiptRequestIds } from "../../../lib/crosschain-reads.mjs";
import {
  loadCrosschainFeed,
  mergeTrackedRequestIds,
} from "../../../lib/crosschain-feed.mjs";
import { migrationKey, parseMigration } from "../../../lib/migration-state.mjs";
import { retryMigrationIntent } from "../../../lib/migration-retry.mjs";
import { migrationDestination } from "../../../lib/migration-destination.mjs";
import {
  LOCK_BUSY,
  LOCK_UNAVAILABLE,
  underWalletLock as lockWallet,
} from "../../../lib/wallet-lock.mjs";
// The network deposits and withdrawals of the batch vault are signed on.
const HUB = (
  crosschain.networks.find((network) => network.role === "hub") ||
  crosschain.networks[0]
).name;
// The hub's chain and its read client come from the registry, not a literal.
const HUB_CHAIN = chainByChainId(crosschain.chainId);

async function read(resource) {
  const response = await fetch("/api/crosschain/" + resource, {
    cache: "no-store",
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "This data is not available right now.");
  return value;
}
// One lock per wallet and vault, shared across remounts of any screen.
const locks = new Set();

// The vault's data and every transaction on it. One instance sits above all
// screens, so a pending operation stays locked and visible wherever the person
// goes. A pending operation is saved, with its nonce, before the wallet is asked
// to sign, and a storage failure stops the signing.
//
// A move from a previous vault signs on the same wallet, so both share one
// browser lock per wallet and neither starts while the other has an operation
// whose result is unknown. `migration` carries that state: requests the move has
// confirmed (shown here while the event index catches up) and whether it holds
// an unresolved operation.
export default function useBatchVault(user, enabled = true, migration = null) {
  const owner = user?.walletAddress;
  const migrationBlocked = !!migration?.blocksNewRequests;
  const migrationIds = migration?.requestIds || [];
  const walletAccount = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [feed, setFeed] = useState(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(enabled),
    [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [succeeded, setSucceeded] = useState(false),
    [lastDone, setLastDone] = useState(null);
  const [pending, setPending] = useState(null),
    [recoveryHash, setRecoveryHash] = useState("");
  // What the last action was, so a screen without the form can still say how
  // collecting or cancelling went.
  const [lastKind, setLastKind] = useState(null);
  const [storageReady, setStorageReady] = useState(false);
  const [requestIds, setRequestIds] = useState([]);
  const key =
    "thesauros.crosschain." +
    crosschain.vault.toLowerCase() +
    "." +
    owner?.toLowerCase();
  const client = vaultClients[HUB_CHAIN?.id];
  const refresh = () => setRevision((value) => value + 1);

  useEffect(() => {
    if (!enabled) return;
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
  }, [key, enabled]);
  const trackedIds = mergeTrackedRequestIds(migrationIds, requestIds);
  const idsKey = trackedIds.join(",");
  useEffect(() => {
    if (!enabled) return undefined;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, owner, idsKey, enabled]);

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
  // One wallet signs one thing at a time, across tabs and across the move from
  // a previous vault.
  async function underWalletLock(task) {
    if (!owner) {
      setMessage("Connect the wallet you used to sign in.");
      return false;
    }
    const result = await lockWallet(migrationKey(owner), task);
    if (result === LOCK_BUSY) {
      setMessage("Another tab is preparing a transaction for this wallet.");
      return false;
    }
    if (result === LOCK_UNAVAILABLE) {
      setMessage("Allow browser storage before submitting a transaction.");
      return false;
    }
    return result;
  }
  function moveHasUnresolved() {
    const saved = parseMigration(
      localStorage.getItem(migrationKey(owner)),
      owner,
    );
    return Object.values(saved.products).some((record) => record.pending);
  }
  async function submit(kind, input) {
    setLastKind(kind);
    return underWalletLock(async () => {
      try {
        if (moveHasUnresolved())
          throw new Error(
            "A transaction from your move to this vault is still unconfirmed. Check it there first.",
          );
        if (migrationBlocked && ["approve", "deposit", "redeem"].includes(kind))
          throw new Error(
            "Finish the open step of your move to this vault before starting a new request.",
          );
      } catch (failure) {
        setMessage(failure.message);
        return false;
      }
      return submitUnlocked(kind, input);
    });
  }
  // What a new request needs before the wallet is asked: the data service
  // answering for this vault and a fresh valuation. A withdrawal needs the
  // same, and nothing about deposits being open.
  async function ensureFresh() {
    const vault = await read("vault");
    assertCrosschainIdentity(vault);
    await Promise.all([
      read("health"),
      read("backend-base"),
      read("backend-arbitrum"),
    ]);
    if (
      vault.tick?.frozen !== false ||
      vault.tick?.quarantined !== false ||
      !Number.isFinite(vault.tick?.ageSeconds) ||
      vault.tick.ageSeconds < 0 ||
      !Number.isFinite(vault.risk?.maxTickAge) ||
      vault.tick.ageSeconds > vault.risk.maxTickAge
    )
      throw new Error(
        "New requests are unavailable until the vault has a fresh accepted valuation.",
      );
  }
  async function submitUnlocked(kind, input) {
    if (locks.has(key) || pending || !storageReady) return false;
    if (localStorage.getItem(key)) {
      setPending(JSON.parse(localStorage.getItem(key)));
      return false;
    }
    locks.add(key);
    setBusy(true);
    setMessage("");
    setSucceeded(false);
    setLastDone(null);
    setLastKind(kind);
    let signing = false;
    try {
      if (!owner || !sameAddress(walletAccount.address, owner))
        throw new Error("Connect the wallet you used to sign in.");
      if (["approve", "deposit", "redeem"].includes(kind)) await ensureFresh();
      else assertCrosschainIdentity(await read("vault"));
      if (walletAccount.chainId !== crosschain.chainId)
        await switchChainAsync({ chainId: crosschain.chainId });
      const provider = await walletAccount.connector.getProvider({
        chainId: crosschain.chainId,
      });
      const wallet = createWalletClient({
        chain: HUB_CHAIN.chain,
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
          setMessage(`Submitted. Waiting for confirmation on ${HUB}…`);
        },
        (intent) => {
          savePending({
            ...intent,
            kind,
            owner,
            chainId: crosschain.chainId,
            // An identical call made earlier must not pass for this one.
            savedAt: Date.now(),
          });
          signing = true;
          setMessage("Confirm the operation in your wallet.");
        },
      );
      trackIds(receiptRequestIds(receipt, owner));
      savePending(null);
      setMessage(
        {
          approve: "Approval confirmed. Now request the deposit.",
          deposit: "Deposit requested.",
          redeem: "Withdrawal requested.",
          claim: "Collected. Your balance is updating.",
          cancel: "Request cancelled.",
        }[kind],
      );
      setSucceeded(true);
      setLastDone({ kind, input, at: Date.now() });
      refresh();
      return true;
    } catch (failure) {
      const rejected =
        failure.walk?.((e) => e.code === 4001) ||
        /User rejected|UserRejected|denied.*request/i.test(failure.message);
      if (signing && rejected) savePending(null);
      setMessage(
        signing && !rejected
          ? "Submission status is unresolved. Check your wallet, then check the transaction before continuing."
          : failure.shortMessage || failure.message,
      );
      return false;
    } finally {
      locks.delete(key);
      setBusy(false);
    }
  }
  // Reopen the saved request in the wallet with the nonce it reserved. Whatever
  // happened to the first prompt, only one transaction with that nonce can run.
  async function retrySaved() {
    if (busy || !pending) return false;
    // The saved nonce only protects a transaction the wallet sent as itself.
    // If the first one is already mined, or a relay is carrying it, sending
    // again could run the request twice: check what is known first.
    if (pending.hash) {
      const [receipt, sent] = await Promise.all([
        client.getTransactionReceipt({ hash: pending.hash }).catch(() => null),
        client.getTransaction({ hash: pending.hash }).catch(() => null),
      ]);
      if (receipt) return recover();
      if (sent && !sameAddress(sent.from, owner)) {
        setMessage(
          "Your wallet sent this through a relay, so it cannot be sent again safely. Wait for it to confirm, then check it here.",
        );
        return false;
      }
    }
    return underWalletLock(async () => {
      locks.add(key);
      setBusy(true);
      try {
        if (
          !sameAddress(pending.owner, owner) ||
          pending.chainId !== crosschain.chainId
        )
          throw new Error("Saved account or network does not match.");
        if (moveHasUnresolved())
          throw new Error("Check the unconfirmed step of your move first.");
        if (walletAccount.chainId !== crosschain.chainId)
          await switchChainAsync({ chainId: crosschain.chainId });
        const provider = await walletAccount.connector.getProvider({
          chainId: crosschain.chainId,
        });
        const wallet = createWalletClient({
          chain: HUB_CHAIN.chain,
          transport: custom(provider),
        });
        const result = await retryMigrationIntent({
          publicClient: client,
          walletClient: wallet,
          owner,
          vaultId: HUB_CHAIN.id,
          pending,
          // A deposit needs deposits open; a withdrawal only a fresh valuation.
          beforeRetry: (kind) =>
            ["claim", "cancel"].includes(kind)
              ? Promise.resolve()
              : kind === "redeem"
                ? ensureFresh()
                : migrationDestination.check(kind),
          onHash: (hash) => savePending({ ...pending, hash }),
        });
        setRecoveryHash(result.hash);
        setMessage(
          "Sent again with the saved nonce, so it can run only once. Check its confirmation below.",
        );
        return true;
      } catch (failure) {
        const cancelled =
          failure.walk?.((e) => e.code === 4001) ||
          /User rejected|UserRejected|denied.*request/i.test(failure.message || "");
        setMessage(
          failure.code === "NONCE_CONSUMED"
            ? "Your wallet already sent a transaction in its place. Paste the hash of the transaction it shows now."
            : cancelled
              ? "You cancelled in the wallet. The saved request is still here to check or send again."
              : `The saved request could not be sent again: ${failure.shortMessage || failure.message || "the wallet did not answer"}`,
        );
        return false;
      } finally {
        locks.delete(key);
        setBusy(false);
        refresh();
      }
    });
  }
  async function recover() {
    if (busy || locks.has(key) || !pending) return;
    // A hash typed in wins: it may be the replacement of the saved one.
    const hash = recoveryHash || pending.hash;
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
          "Saved operation does not match this wallet and vault.",
        );
      const [receipt, transaction, chainId, head] = await Promise.all([
        client.getTransactionReceipt({ hash }),
        client.getTransaction({ hash }),
        client.getChainId(),
        client.getBlockNumber({ cacheTime: 0 }),
      ]);
      // The same call made before this request was saved is a different
      // transaction: an earlier deposit of the same amount must not settle
      // this one.
      if (Number.isFinite(pending.savedAt) && receipt.blockNumber != null) {
        const block = await client.getBlock({ blockNumber: receipt.blockNumber });
        if (Number(block.timestamp) * 1000 < pending.savedAt - 10 * 60_000)
          throw new Error("That transaction is older than this request.");
      }
      // A wallet relay changes the sender and target; the events still show the
      // call. When the wallet sent it as itself, the nonce must be the saved one.
      if (
        chainId === crosschain.chainId &&
        receipt.transactionHash.toLowerCase() === hash.toLowerCase() &&
        receiptShowsCall(receipt, owner, pending.address, pending.data) &&
        !(
          sameAddress(transaction.from, owner) &&
          Number.isSafeInteger(pending.nonce) &&
          transaction.nonce !== pending.nonce
        )
      ) {
        trackIds(receiptRequestIds(receipt, owner));
        savePending(null);
        setRecoveryHash("");
        setMessage(`Transaction confirmed on ${HUB}.`);
        refresh();
        return;
      }
      // The saved hash tells which nonce the wallet really used.
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
        (Number.isSafeInteger(nonce) && nonce !== transaction.nonce)
      )
        throw new Error("This transaction does not match the saved operation.");
      const sameCall =
        sameAddress(transaction.to, pending.address) &&
        transaction.value === 0n &&
        transaction.input?.toLowerCase() === pending.data?.toLowerCase();
      if (!sameCall) {
        // Another transaction took the saved nonce: the request was cancelled
        // or replaced in the wallet. Without a saved nonce that cannot be told
        // apart from an unrelated transaction.
        if (!Number.isSafeInteger(nonce))
          throw new Error(
            "This transaction does not match the saved operation.",
          );
        savePending(null);
        setRecoveryHash("");
        setMessage(
          "That request was cancelled or replaced by another transaction in your wallet. Your balances are being read again.",
        );
        refresh();
        return;
      }
      if (receipt.status === "reverted") {
        savePending(null);
        setRecoveryHash("");
        setMessage(
          "The transaction reverted. You can prepare a new operation.",
        );
      } else {
        verifyCrosschainReceipt(receipt, hash, owner, pending.address);
        trackIds(receiptRequestIds(receipt, owner));
        savePending(null);
        setRecoveryHash("");
        setMessage(`Transaction confirmed on ${HUB}.`);
      }
      refresh();
    } catch {
      setMessage(
        "The matching transaction is not confirmed. Check your wallet or explorer before retrying.",
      );
    } finally {
      locks.delete(key);
      setBusy(false);
    }
  }
  // Collecting and cancelling never depend on the data service being healthy.
  const blocked =
    busy ||
    !!pending ||
    !storageReady ||
    !feed?.vault ||
    !feed?.user ||
    !owner ||
    migrationBlocked;
  return {
    feed,
    error,
    loading,
    busy,
    message,
    succeeded,
    lastDone,
    lastKind,
    pending,
    recoveryHash,
    setRecoveryHash,
    storageReady,
    blocked,
    newRequestsBlocked: blocked || !!feed?.backendError,
    walletMatches: !!owner && sameAddress(walletAccount.address, owner),
    submit,
    recover,
    // Only an operation saved with its nonce can be reopened safely.
    retrySaved: Number.isSafeInteger(pending?.nonce) ? retrySaved : null,
    migrationBlocked,
    refresh,
    clearMessage: () => {
      setMessage("");
      setSucceeded(false);
      setLastDone(null);
      setLastKind(null);
    },
  };
}
