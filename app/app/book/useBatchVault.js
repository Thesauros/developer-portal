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
import { loadCrosschainFeed } from "../../../lib/crosschain-feed.mjs";
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

// The batch vault's data and every transaction on it. One instance sits above
// all screens, so a pending operation stays locked and visible wherever the
// person goes. A pending operation is saved before the wallet is asked to sign,
// and a storage failure stops the signing.
export default function useBatchVault(user, enabled = true) {
  const owner = user?.walletAddress;
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
  const idsKey = requestIds.join(",");
  useEffect(() => {
    if (!enabled) return undefined;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, owner, idsKey, enabled]);

  function trackIds(ids) {
    const combined = [...new Set([...requestIds, ...ids])].slice(-20);
    localStorage.setItem(key + ".requests", JSON.stringify(combined));
    setRequestIds(combined);
  }
  async function trackManualRequest(id) {
    if (!/^(?:0|[1-9]\d{0,77})$/.test(id)) {
      setMessage("Enter a valid unsigned request ID.");
      return false;
    }
    try {
      await read("user?requests=" + id);
      trackIds([id]);
      return true;
    } catch (failure) {
      setMessage(failure.message);
      return false;
    }
  }
  function savePending(value) {
    // A storage failure must stop signing; otherwise a reload could duplicate a request.
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
    setPending(value);
  }
  async function submit(kind, input) {
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
          "Saved operation does not match this wallet and vault.",
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
        setMessage(`Transaction confirmed on ${HUB}.`);
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
    busy || !!pending || !storageReady || !feed?.vault || !feed?.user || !owner;
  return {
    feed,
    error,
    loading,
    busy,
    message,
    succeeded,
    lastDone,
    pending,
    recoveryHash,
    setRecoveryHash,
    storageReady,
    blocked,
    newRequestsBlocked: blocked || !!feed?.backendError,
    walletMatches: !!owner && sameAddress(walletAccount.address, owner),
    submit,
    recover,
    refresh,
    trackManualRequest,
    clearMessage: () => {
      setMessage("");
      setSucceeded(false);
      setLastDone(null);
    },
  };
}
