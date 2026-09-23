"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  historyKey,
  isPendingTransaction,
  mergeTransactions,
  parseTransactionHistory,
  receiptMatches,
  replacementOutcome,
  validateTransaction,
  validNonce,
} from "../../lib/transaction-history.mjs";
import { vaults as supportedVaults } from "../../lib/vault-contracts.mjs";

const emptyHistory = { owner: "", rows: [] };

export default function useEarnAccount(owner) {
  const account = historyKey(owner) ? owner.toLowerCase() : "";
  const [snapshot, setSnapshot] = useState({ owner: "", vaults: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(emptyHistory);
  const [storageError, setStorageError] = useState("");
  const [receiptError, setReceiptError] = useState("");
  const historyRef = useRef(emptyHistory);
  const requestRef = useRef(null);
  const generation = useRef(0);
  const mountedAccount = useRef("");
  const pollRef = useRef(null);
  const recoveryRef = useRef(new Map());

  const save = useCallback(
    (rows) => {
      if (!account || mountedAccount.current !== account) return;
      let combined = rows;
      try {
        combined = mergeTransactions(
          parseTransactionHistory(
            localStorage.getItem(historyKey(account)),
            account,
          ),
          rows,
        );
        localStorage.setItem(
          historyKey(account),
          JSON.stringify({
            version: 1,
            owner: account,
            transactions: combined,
          }),
        );
        setStorageError("");
      } catch {
        setStorageError(
          "Transaction history could not be saved in this browser. Keep the transaction link before leaving.",
        );
      }
      const next = { owner: account, rows: combined };
      historyRef.current = next;
      setHistory(next);
    },
    [account],
  );

  const load = useCallback(
    async (force = false) => {
      if (!account || mountedAccount.current !== account) return;
      if (requestRef.current && !force) return;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      const version = ++generation.current;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 60000);
      setLoading(true);
      try {
        const rows = await Promise.all(
          supportedVaults.map(async (vault) => {
            let row;
            try {
              const query = new URLSearchParams({ vault: vault.id });
              if (force) query.set("refresh", "1");
              const response = await fetch("/app/onchain?" + query, {
                signal: controller.signal,
                cache: "no-store",
                credentials: "same-origin",
              });
              const body = await response.json();
              if (!response.ok)
                throw new Error(body.error || "Could not read this network.");
              if (!Array.isArray(body.vaults))
                throw new Error("The network response could not be read.");
              row = body.vaults.find((item) => item?.id === vault.id);
              if (!row)
                throw new Error("This network did not return a position.");
              if (
                row.status === "ready" &&
                row.owner?.toLowerCase() !== account
              )
                throw new Error(
                  "The position does not match this wallet. Refresh to try again.",
                );
            } catch (failure) {
              if (controller.signal.aborted && !timedOut) return null;
              row = {
                id: vault.id,
                status: "unavailable",
                error: timedOut
                  ? "This network is taking longer than expected. Refresh to try again."
                  : failure.message || "Could not read this network.",
              };
            }
            if (
              version !== generation.current ||
              mountedAccount.current !== account
            )
              return null;
            // Each chain becomes usable as soon as it responds. A failed or slow
            // read must never replace a ready position from the other network.
            setSnapshot((previous) => {
              const prior = previous.owner === account ? previous.vaults : [];
              const merged =
                row.status === "ready"
                  ? row
                  : {
                      ...prior.find((item) => item.id === vault.id),
                      ...row,
                    };
              return {
                owner: account,
                vaults: supportedVaults
                  .map((definition) =>
                    definition.id === vault.id
                      ? merged
                      : prior.find((item) => item.id === definition.id),
                  )
                  .filter(Boolean),
              };
            });
            if (row.status === "ready") setError("");
            return row;
          }),
        );
        if (
          version !== generation.current ||
          mountedAccount.current !== account
        )
          return;
        setError(
          rows.every((row) => row?.status !== "ready")
            ? "Could not read the supported networks. Your last received values may be out of date. Refresh to try again."
            : "",
        );
        return rows;
      } finally {
        clearTimeout(timeout);
        if (requestRef.current === controller) requestRef.current = null;
        if (
          version === generation.current &&
          mountedAccount.current === account
        )
          setLoading(false);
      }
    },
    [account],
  );

  const refresh = useCallback(() => load(true), [load]);

  const recordTransaction = useCallback(
    (record) => {
      if (!account || mountedAccount.current !== account) return false;
      const existing =
        historyRef.current.owner === account ? historyRef.current.rows : [];
      const matches = existing.filter(
        (row) =>
          row.hash === record?.hash?.toLowerCase() &&
          (!record?.vaultId || row.vaultId === record.vaultId),
      );
      const prior = matches.length === 1 ? matches[0] : undefined;
      const updated = validateTransaction({
        ...prior,
        ...record,
        createdAt: prior?.createdAt ?? record?.createdAt ?? Date.now(),
        status: record?.status ?? prior?.status ?? "pending",
        updatedAt: Date.now(),
      });
      if (!updated) {
        setStorageError(
          "This transaction could not be added to browser history. Keep its explorer link.",
        );
        return false;
      }
      const replacements = updated.replacedHash
        ? existing
            .filter(
              (row) =>
                row.vaultId === updated.vaultId &&
                row.hash === updated.replacedHash &&
                isPendingTransaction(row),
            )
            .map((row) => ({
              ...row,
              status: "cancelled",
              updatedAt: Date.now(),
            }))
        : [];
      save(mergeTransactions(existing, [...replacements, updated]));
      if (isPendingTransaction(updated)) pollRef.current?.();
      return true;
    },
    [account, save],
  );

  const resolveTransaction = useCallback(
    async (record, replacementHash) => {
      const original =
        historyRef.current.owner === account
          ? historyRef.current.rows.find(
              (row) =>
                row.hash === record?.hash?.toLowerCase() &&
                row.vaultId === record?.vaultId,
            )
          : null;
      if (!original || !isPendingTransaction(original))
        throw new Error(
          "This transaction is no longer pending. Refresh its status.",
        );
      if (
        !/^0x[\da-f]{64}$/i.test(replacementHash || "") ||
        replacementHash.toLowerCase() === original.hash
      )
        throw new Error(
          "Enter the different transaction hash shown for the replacement in your wallet.",
        );
      const key = account + ":" + original.vaultId + ":" + original.hash;
      if (recoveryRef.current.has(key))
        return recoveryRef.current.get(key).promise;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const promise = (async () => {
        try {
          const query = new URLSearchParams({
            kind: "replacement",
            vault: original.vaultId,
            hash: replacementHash,
            original: original.hash,
          });
          if (validNonce(original.nonce))
            query.set("nonce", String(original.nonce));
          const response = await fetch("/app/onchain?" + query, {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          });
          const body = await response.json();
          if (!response.ok)
            throw new Error(
              body.error || "The replacement could not be verified.",
            );
          if (
            mountedAccount.current !== account ||
            historyRef.current.owner !== account
          )
            throw new Error(
              "The connected account changed. Open this wallet’s transaction history to continue.",
            );
          const current = historyRef.current.rows.find(
            (row) =>
              row.hash === original.hash && row.vaultId === original.vaultId,
          );
          if (!current || !isPendingTransaction(current))
            throw new Error(
              "The original transaction’s status changed. Refresh before continuing.",
            );
          const outcome = replacementOutcome(current, body, account);
          save(
            mergeTransactions(historyRef.current.rows, [
              outcome.original,
              ...(outcome.replacement ? [outcome.replacement] : []),
            ]),
          );
          setReceiptError("");
          load(true);
          return outcome;
        } catch (failure) {
          if (controller.signal.aborted)
            throw new Error(
              "Replacement verification was interrupted. The original transaction is still pending.",
            );
          throw failure;
        } finally {
          clearTimeout(timeout);
          recoveryRef.current.delete(key);
        }
      })();
      recoveryRef.current.set(key, { controller, promise });
      return promise;
    },
    [account, load, save],
  );

  useEffect(() => {
    mountedAccount.current = account;
    setError("");
    setStorageError("");
    setReceiptError("");
    setSnapshot({ owner: account, vaults: [] });
    let rows = [];
    if (account) {
      try {
        rows = parseTransactionHistory(
          localStorage.getItem(historyKey(account)),
          account,
        );
      } catch {
        setStorageError(
          "Saved transaction history could not be read. Confirm outstanding transactions in your wallet before submitting another.",
        );
      }
    }
    historyRef.current = { owner: account, rows };
    setHistory(historyRef.current);
    if (account) load(false);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") load(false);
    }, 30000);
    const visible = () => {
      if (document.visibilityState === "visible") {
        load(false);
        pollRef.current?.();
      }
    };
    const storageChanged = (event) => {
      if (!account || event.key !== historyKey(account)) return;
      try {
        const incoming = parseTransactionHistory(event.newValue, account);
        const current =
          historyRef.current.owner === account ? historyRef.current.rows : [];
        const next = {
          owner: account,
          rows: mergeTransactions(current, incoming),
        };
        historyRef.current = next;
        setHistory(next);
        setStorageError("");
        pollRef.current?.();
      } catch {
        setStorageError(
          "Updated transaction history could not be read from another tab.",
        );
      }
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("storage", storageChanged);
    return () => {
      mountedAccount.current = "";
      generation.current++;
      requestRef.current?.abort();
      requestRef.current = null;
      for (const job of recoveryRef.current.values()) job.controller.abort();
      recoveryRef.current.clear();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("storage", storageChanged);
    };
  }, [account, load]);

  useEffect(() => {
    if (!account) return;
    let stopped = false;
    let running = false;
    const controller = new AbortController();
    async function poll() {
      if (stopped || running || document.visibilityState === "hidden") return;
      const rows =
        historyRef.current.owner === account
          ? historyRef.current.rows.filter(isPendingTransaction)
          : [];
      if (!rows.length) {
        setReceiptError("");
        return;
      }
      running = true;
      let problem = "",
        confirmed = false;
      let index = 0;
      async function worker() {
        while (!stopped && index < rows.length) {
          const record = rows[index++];
          try {
            const query = new URLSearchParams({
              kind: "receipt",
              vault: record.vaultId,
              hash: record.hash,
            });
            const response = await fetch("/app/onchain?" + query, {
              cache: "no-store",
              credentials: "same-origin",
              signal: controller.signal,
            });
            const receipt = await response.json();
            if (!response.ok)
              throw new Error(
                receipt.error ||
                  "Transaction status is temporarily unavailable.",
              );
            if (stopped || mountedAccount.current !== account) return;
            if (receipt.status === "pending") {
              if (receipt.found && validNonce(receipt.nonce)) {
                if (!receiptMatches(record, receipt, account, true))
                  throw new Error(
                    "The pending transaction details do not match the saved request. Check your wallet before continuing.",
                  );
                const current = historyRef.current.rows.find(
                  (row) =>
                    row.hash === record.hash && row.vaultId === record.vaultId,
                );
                if (
                  current &&
                  isPendingTransaction(current) &&
                  current.nonce !== receipt.nonce
                ) {
                  // Persist metadata directly: starting another poll here would
                  // recurse through the same still-pending transaction.
                  save(
                    mergeTransactions(historyRef.current.rows, [
                      {
                        ...current,
                        nonce: receipt.nonce,
                        updatedAt: Date.now(),
                      },
                    ]),
                  );
                }
              }
              continue;
            }
            if (!receiptMatches(record, receipt, account))
              throw new Error(
                "A receipt did not match the saved transaction. Check it in your wallet before submitting another.",
              );
            const current = historyRef.current.rows.find(
              (row) =>
                row.hash === record.hash && row.vaultId === record.vaultId,
            );
            if (!current || !isPendingTransaction(current)) continue;
            recordTransaction({
              ...current,
              input: receipt.input,
              status: receipt.status,
              nonce: validNonce(receipt.nonce) ? receipt.nonce : current.nonce,
              amount:
                receipt.status === "success" && receipt.actualAmount != null
                  ? receipt.actualAmount
                  : current.amount,
              amountEstimated:
                receipt.status === "success" && receipt.actualAmount != null
                  ? false
                  : current.amountEstimated,
            });
            confirmed = true;
          } catch (failure) {
            if (stopped || controller.signal.aborted) return;
            problem =
              failure.message ||
              "Transaction status is temporarily unavailable. Pending transactions are preserved.";
          }
        }
      }
      try {
        await Promise.all([worker(), worker(), worker()]);
      } finally {
        running = false;
        if (!stopped && mountedAccount.current === account) {
          setReceiptError(problem);
          if (confirmed) load(true);
        }
      }
    }
    pollRef.current = poll;
    poll();
    const interval = setInterval(poll, 7000);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(interval);
      if (pollRef.current === poll) pollRef.current = null;
    };
  }, [account, load, recordTransaction, save]);

  const transactions = history.owner === account ? history.rows : [];
  return {
    owner: account,
    vaults: snapshot.owner === account ? snapshot.vaults : [],
    loading: !!account && (loading || snapshot.owner !== account),
    error,
    refresh,
    transactions,
    recordTransaction,
    resolveTransaction,
    historyError: [storageError, receiptError].filter(Boolean).join(" "),
    pendingVaultIds: [
      ...new Set(
        transactions.filter(isPendingTransaction).map((row) => row.vaultId),
      ),
    ],
  };
}
