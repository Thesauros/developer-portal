"use client";

import s from "./migration.module.css";

function units(value) {
  if (value == null || !/^\d+$/.test(String(value))) return "—";
  const integer = BigInt(value);
  return `${integer / 1_000_000n}.${String(integer % 1_000_000n).padStart(6, "0")}`;
}

const short = (value) =>
  value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";

const stageDetails = {
  check: {
    title: "Checking your legacy position",
    body: "Reading your shares and contract state. Your balance is unknown until the check completes.",
    action: "Check again",
    step: 0,
  },
  withdraw: {
    title: "Withdraw from the legacy product",
    body: "Confirm a separate withdrawal transaction in your wallet. The confirmed transaction determines the amount received.",
    action: "Withdraw funds",
    step: 0,
  },
  withdraw_pending: {
    title: "Waiting for withdrawal confirmation",
    body: "Checking the transaction and USDC received. Wait until this operation is verified before withdrawing again.",
    step: 0,
  },
  base: {
    title: "Prepare your USDC on Base",
    body: "If you withdrew on Arbitrum, transfer native USDC to your own wallet on Base, then check that the funds have arrived.",
    action: "Check funds on Base",
    step: 1,
  },
  approve: {
    title: "Approve USDC on Base",
    body: "Approval lets the new contract use the selected USDC amount. The deposit requires a separate confirmation.",
    action: "Approve USDC on Base",
    step: 2,
  },
  deposit: {
    title: "Deposit into the new contract",
    body: "Confirm your USDC deposit request on Base. Shares become available after the epoch settles and a separate claim.",
    action: "Confirm deposit on Base",
    step: 3,
  },
  deposit_pending: {
    title: "Waiting for deposit confirmation",
    body: "Checking your submitted request. After a reload, continue with this transaction without repeating the deposit.",
    step: 3,
  },
  settlement: {
    title: "Waiting for epoch settlement",
    body: "Your USDC are in the new contract's deposit request. You can claim your shares here once the epoch settles.",
    step: 4,
  },
  claim: {
    title: "Claim your new vault shares",
    body: "Your deposit has settled. Confirm a separate transaction to claim your shares on Base.",
    action: "Claim shares on Base",
    step: 4,
  },
  complete: {
    title: "Migration complete",
    body: "Completion is confirmed onchain. Your new position is available in the cross-chain product.",
    step: 5,
  },
  error: {
    title: "Check your current step",
    body: "Refresh the onchain state before continuing. A failed check does not mean a zero balance.",
    action: "Continue migration",
    step: null,
  },
  recover: {
    title: "Resume your migration",
    body: "Enter a migration transaction for this wallet. Its result will be verified onchain.",
    step: null,
  },
};

function TransactionLinks({ transactions }) {
  if (!transactions?.length) return null;
  return (
    <ul className={s.transactions} aria-label="Migration transactions">
      {transactions.map((transaction, index) => (
        <li key={`${transaction.hash}-${index}`}>
          <span>{transaction.label}</span>
          <a
            href={`${transaction.explorer}/tx/${transaction.hash}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`${transaction.label}: ${transaction.hash}, open block explorer`}
          >
            {short(transaction.hash)} ↗
          </a>
        </li>
      ))}
    </ul>
  );
}

function MigrationProduct({ product, model }) {
  const details = stageDetails[product.stage] || stageDetails.check;
  const ready = product.positionStatus === "ready";
  const oldClosed =
    ready &&
    /^\d+$/.test(String(product.shares)) &&
    BigInt(product.shares) === 0n;
  const withdrawNetwork = product.name || `Chain ${product.chainId}`;
  const needsOldNetwork = ["withdraw", "withdraw_pending"].includes(
    product.stage,
  );
  const network = needsOldNetwork ? withdrawNetwork : "Base · chainId 8453";
  const pending = ["withdraw_pending", "deposit_pending"].includes(
    product.stage,
  );
  const editableAmount = ["approve", "deposit", "base"].includes(product.stage);
  const steps = [
    `Withdraw · ${withdrawNetwork}`,
    "Funds on Base",
    "Approve · Base",
    "Deposit · Base",
    "Settle and claim shares",
  ];
  const headingId = `migration-${product.id}`;
  const amountId = `${headingId}-amount`;
  const recoveryId = `${headingId}-recovery`;
  const error = product.error || product.positionError;
  const refreshAction = ["base", "check"].includes(product.stage);
  const selectedAmount = product.selected || product.amount;
  const knownAmounts = [product.amount, product.cash].every(
    (value) => value != null && /^\d+$/.test(String(value)),
  );
  const maximum = knownAmounts
    ? BigInt(product.amount) < BigInt(product.cash)
      ? product.amount
      : product.cash
    : null;

  if (product.stage === "complete")
    return (
      <article className={s.product} aria-labelledby={headingId}>
        <div className={s.productHeader}>
          <h3 id={headingId}>Migration from {withdrawNetwork} complete</h3>
          <span className={s.network}>Base · 8453</span>
        </div>
        <p className={s.meta} role="status">
          Your new position is confirmed onchain and available in the
          cross-chain product.
        </p>
        <TransactionLinks transactions={product.txs} />
      </article>
    );

  return (
    <article className={s.product} aria-labelledby={headingId}>
      <div className={s.productHeader}>
        <div>
          {!oldClosed && <span className={s.eyebrow}>Legacy product</span>}
          <h3 id={headingId}>
            {oldClosed
              ? `Continue migration from ${withdrawNetwork}`
              : `USDC · ${withdrawNetwork}`}
          </h3>
        </div>
        <span className={s.network}>
          {oldClosed ? "Base · 8453" : product.chainId}
        </span>
      </div>

      <dl className={s.balances}>
        {!oldClosed && (
          <div>
            <dt>Remaining in legacy product</dt>
            <dd>
              {ready ? units(product.assets) : "—"} <small>USDC</small>
            </dd>
          </div>
        )}
        {!oldClosed && (
          <div>
            <dt>Legacy shares</dt>
            <dd>{ready ? units(product.shares) : "—"}</dd>
          </div>
        )}
        {product.amount != null && (
          <div>
            <dt>Remaining to deposit after withdrawal</dt>
            <dd>
              {units(product.amount)} <small>USDC</small>
            </dd>
          </div>
        )}
      </dl>

      {!ready && (
        <p className={s.notice} role="status">
          {product.positionStatus === "error"
            ? "Your legacy position is unknown: the contract could not be read."
            : "Checking your legacy position onchain…"}
        </p>
      )}

      <ol className={s.steps} aria-label="Migration steps">
        {steps.map((step, index) => (
          <li
            key={step}
            className={
              details.step === index
                ? s.current
                : details.step > index
                  ? s.done
                  : ""
            }
            aria-current={details.step === index ? "step" : undefined}
          >
            <span aria-hidden="true">
              {details.step > index ? "✓" : index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>

      <div className={s.currentStep}>
        <div className={s.stepHeading}>
          <h4>{details.title}</h4>
          {!["check", "error", "recover", "complete"].includes(
            product.stage,
          ) && <span className={s.network}>{network}</span>}
        </div>
        <p role="status">
          {product.stage === "base" && product.chainId === 8453
            ? "Checking native USDC in your Base wallet after the confirmed withdrawal."
            : details.body}
        </p>

        {product.stage === "base" && product.chainId !== 8453 && (
          <div className={s.transfer}>
            <strong>Recipient: your own wallet on Base</strong>
            <code>{model.owner}</code>
            <p>
              Transfer the funds yourself. To continue, you need native USDC on
              Base and ETH for transaction fees.
            </p>
          </div>
        )}

        {product.cash != null && editableAmount && (
          <p className={s.meta}>
            Available in your Base wallet: {units(product.cash)} USDC
          </p>
        )}

        {editableAmount && typeof product.setAmountInput === "function" && (
          <div className={s.amountField}>
            <label htmlFor={amountId}>Deposit amount on Base, USDC</label>
            <div className={s.amountInput}>
              <input
                id={amountId}
                inputMode="decimal"
                autoComplete="off"
                placeholder={units(selectedAmount)}
                value={product.amountInput ?? ""}
                onChange={(event) => product.setAmountInput(event.target.value)}
                disabled={Boolean(model.busy)}
                aria-describedby={`${amountId}-help`}
              />
              <button
                type="button"
                className={s.secondary}
                disabled={Boolean(model.busy) || maximum == null}
                onClick={() => product.setAmountInput(units(maximum))}
              >
                Max
              </button>
            </div>
            <p className={s.meta} id={`${amountId}-help`}>
              Up to 6 decimal places. You can deposit part of your funds and
              continue later.
            </p>
          </div>
        )}

        {["approve", "deposit"].includes(product.stage) && (
          <p>
            <strong>
              Selected for{" "}
              {product.stage === "approve" ? "approval" : "deposit"}:{" "}
              {units(selectedAmount)} USDC · Base
            </strong>
          </p>
        )}

        {model.destination &&
          ["approve", "deposit"].includes(product.stage) && (
            <dl className={s.destination}>
              <div>
                <dt>
                  {product.stage === "approve"
                    ? "Approval recipient"
                    : "Deposit contract"}{" "}
                  · Base
                </dt>
                <dd>
                  <a
                    href={`${model.destination.explorer}/address/${model.destination.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {model.destination.address} ↗
                  </a>
                </dd>
              </div>
              {model.destination.asset && (
                <div>
                  <dt>Native USDC · Base</dt>
                  <dd>
                    <code>{model.destination.asset}</code>
                  </dd>
                </div>
              )}
            </dl>
          )}

        {product.requestId != null && (
          <p className={s.meta}>
            New vault request: #{String(product.requestId)}
          </p>
        )}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}

        {details.action && (
          <div className={s.actions}>
            <button
              type="button"
              className={s.primary}
              onClick={refreshAction ? model.refresh : product.act}
              disabled={
                Boolean(model.busy || model.loading) ||
                (!refreshAction && !product.canAct)
              }
            >
              {details.action}
            </button>
          </div>
        )}
        {pending && (
          <p className={s.meta}>
            Status is checked onchain. The transaction hash is saved so you can
            continue later.
          </p>
        )}
      </div>

      <TransactionLinks transactions={product.txs} />

      {product.recovery && typeof product.retry === "function" && (
        <div className={s.recovery}>
          <p>
            If you reloaded while signing or your wallet did not return a hash,
            reopen the saved request. It uses the same nonce and can execute
            only once.
          </p>
          <button
            type="button"
            className={s.secondary}
            onClick={product.retry}
            disabled={Boolean(model.busy || model.loading)}
          >
            Reopen wallet request
          </button>
          <p className={s.meta}>
            Network:{" "}
            {product.pendingChainId === 42161
              ? "Arbitrum · 42161"
              : "Base · 8453"}{" "}
            · nonce {product.pendingNonce}
          </p>
        </div>
      )}

      {(product.recovery || product.allowImport) &&
        typeof product.recover === "function" && (
          <details className={s.recovery} open={product.recovery || undefined}>
            <summary>Continue with a transaction hash</summary>
            <p>
              Enter a migration transaction hash. We will verify the wallet,
              contract and transaction result before continuing.
            </p>
            <label htmlFor={recoveryId}>Migration transaction hash</label>
            <input
              id={recoveryId}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={product.recoveryHash ?? ""}
              onChange={(event) =>
                product.setRecoveryHash?.(event.target.value)
              }
              disabled={Boolean(model.busy)}
            />
            <button
              type="button"
              className={s.secondary}
              onClick={product.recover}
              disabled={Boolean(model.busy) || !product.recoveryHash?.trim()}
            >
              Check transaction
            </button>
          </details>
        )}

      {!oldClosed && (
        <a
          className={s.contractLink}
          href={`${product.explorer}/address/${product.address}`}
          target="_blank"
          rel="noreferrer"
        >
          Legacy contract: {short(product.address)} ↗
        </a>
      )}
    </article>
  );
}

export default function MigrationPanel({ model }) {
  if (!model?.owner) return null;
  const products = model.products || [];
  const allComplete =
    products.length > 0 &&
    products.every((product) => product.stage === "complete");
  if (!products.length && !model.error && !model.storageError) return null;
  return (
    <section
      className={s.panel}
      aria-label="Migrate to the cross-chain product"
      lang="en"
      aria-busy={Boolean(model.loading)}
    >
      {!allComplete && (
        <div className={s.banner}>
          <div className={s.bannerIcon} aria-hidden="true">
            ↗
          </div>
          <div>
            <h2>Migrate your funds</h2>
            <p>
              Withdraw from the legacy product and deposit into the new
              cross-chain contract through Base. Confirm each transaction
              separately in your wallet.
            </p>
          </div>
          <button
            className={s.secondary}
            type="button"
            onClick={model.refresh}
            disabled={Boolean(model.loading || model.busy)}
          >
            {model.loading ? "Checking…" : "Refresh status"}
          </button>
        </div>
      )}
      {model.error && (
        <p className={s.error} role="alert">
          {model.error}
        </p>
      )}
      {model.storageError && (
        <p className={s.error} role="alert">
          {model.storageError}
        </p>
      )}
      {model.loading && !products.length && (
        <p className={s.notice} role="status">
          Checking legacy contracts for your connected wallet. Your balance is
          still unknown.
        </p>
      )}
      <div className={s.products}>
        {products.map((product) => (
          <MigrationProduct
            key={`${model.owner}-${product.id}`}
            product={product}
            model={model}
          />
        ))}
      </div>
    </section>
  );
}
