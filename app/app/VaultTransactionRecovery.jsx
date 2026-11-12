"use client";

import s from "./crosschain.module.css";

const networkLabel = (chainId) =>
  chainId === 8453
    ? "Base · 8453"
    : chainId === 42161
      ? "Arbitrum · 42161"
      : "Unknown network";

export default function VaultTransactionRecovery({
  transactions = [],
  busy = false,
  loading = false,
  storageError = "",
}) {
  if (!transactions.length && !storageError) return null;
  const disabled = busy || loading;
  return (
    <section
      className={`${s.workspace} ${s.card}`}
      aria-label="Wallet transaction recovery"
      aria-busy={Boolean(disabled)}
      lang="en"
    >
      <h3>Pending wallet transaction</h3>
      {storageError && (
        <p className={s.notice} role="alert">
          {storageError}
        </p>
      )}
      {transactions.length > 0 && (
        <p>
          A wallet request is unresolved. Wait for confirmation or check its
          result before starting another transaction.
        </p>
      )}
      {transactions.map((transaction, index) => {
        const inputId = `vault-transaction-hash-${transaction.id || index}`;
        const hasHash = Boolean(
          transaction.recoveryHash?.trim() || transaction.pendingHash,
        );
        return (
          <article className={s.notice} key={transaction.id || index}>
            <p>
              Network: {networkLabel(transaction.pendingChainId)}
              {Number.isSafeInteger(transaction.pendingNonce) && (
                <> · nonce {transaction.pendingNonce}</>
              )}
            </p>
            {transaction.pendingHash && transaction.pendingExplorer && (
              <a
                href={`${transaction.pendingExplorer}/tx/${transaction.pendingHash}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`View pending transaction ${transaction.pendingHash} in block explorer`}
              >
                {transaction.pendingHash} ↗
              </a>
            )}
            <label htmlFor={inputId}>Transaction or replacement hash</label>
            <input
              id={inputId}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={transaction.recoveryHash || ""}
              onChange={(event) =>
                transaction.setRecoveryHash?.(event.target.value)
              }
              disabled={disabled}
              aria-describedby={`${inputId}-help`}
            />
            <p className={s.muted} id={`${inputId}-help`}>
              Use the submitted hash or a replacement from your wallet. Its
              account, network and result will be verified onchain.
            </p>
            {transaction.error && <p role="alert">{transaction.error}</p>}
            <div className={s.actions}>
              <button
                type="button"
                onClick={transaction.recover}
                disabled={
                  disabled ||
                  !hasHash ||
                  typeof transaction.recover !== "function"
                }
              >
                Check confirmation
              </button>
              {typeof transaction.retry === "function" && (
                <button
                  type="button"
                  onClick={transaction.retry}
                  disabled={disabled}
                >
                  Retry the same wallet request
                </button>
              )}
            </div>
            {typeof transaction.retry === "function" && (
              <p className={s.muted}>
                The saved request uses the same nonce and can execute only once,
                even if you reloaded while signing or your wallet did not return
                a hash.
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}
