"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { getVault } from "../../../lib/vault-contracts.mjs";
import { MIGRATION_VAULT_IDS } from "../../../lib/migration-state.mjs";
import { marketingHref, documentationHref } from "../../../lib/site-links.mjs";
import { ConnectAction } from "../wallet/WalletAccess";
import { finishMove, isFinished } from "./finished";
import { TransactionPanel } from "../book/InstantTransaction";
import { batchClosing } from "../book/ActionPanel";
import { money, pct, short, NetworkMarks, TokenMark } from "../book/parts";
import b from "../book/book.module.css";
import m from "./move.module.css";

// Exact token units as the amount a person reads: two decimals, never rounded up
// past what the chain holds.
const whole = (value) =>
  /^\d+$/.test(String(value ?? "")) ? BigInt(value) : null;
const usdc = (value, digits = 2) => {
  const units = whole(value);
  return units == null ? "—" : money(Number(units) / 1e6, digits);
};
const exact = (value) => {
  const units = whole(value);
  if (units == null) return "";
  const fraction = String(units % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return `${units / 1_000_000n}${fraction ? "." + fraction : ""}`;
};

// Which step a move is on. The checks behind it (receipts, balances, request
// states) are read from the chain every time, never from a saved flag.
const STEP_OF = {
  check: "withdraw",
  withdraw: "withdraw",
  withdraw_pending: "withdraw",
  base: "bring",
  approve: "deposit",
  deposit: "deposit",
  deposit_pending: "deposit",
  recover: "deposit",
  settlement: "settle",
  claim: "collect",
  complete: "done",
};

function Mark({ state, index }) {
  return (
    <span className={m.mark} data-state={state} aria-hidden="true">
      {state === "done" ? (
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : state === "waiting" ? (
        <i className={m.spinner} />
      ) : (
        index
      )}
    </span>
  );
}

function Step({ index, state, title, summary, children }) {
  return (
    <li className={m.step} data-state={state} aria-current={state === "current" || state === "waiting" ? "step" : undefined}>
      <Mark state={state} index={index} />
      <div className={m.stepBody}>
        <h3>{title}</h3>
        {state === "done" || state === "next" ? (
          summary && <p className={m.stepSummary}>{summary}</p>
        ) : (
          <div className={m.stepOpen}>{children}</div>
        )}
      </div>
    </li>
  );
}

function TxLinks({ rows }) {
  if (!rows?.length) return null;
  return (
    <ul className={m.receipts} aria-label="Transactions of this move">
      {rows.map((row, i) => (
        <li key={row.hash + i}>
          <span>{row.label}</span>
          <a href={`${row.explorer}/tx/${row.hash}`} target="_blank" rel="noreferrer">
            {short(row.hash)} ↗
          </a>
        </li>
      ))}
    </ul>
  );
}

// A transaction whose result the app does not know yet. It checks by itself
// every few seconds; the tools below are for when the wallet did something else.
function Unresolved({ product, model }) {
  const [open, setOpen] = useState(!product.pendingHash);
  return (
    <div className={m.unresolved}>
      <p className={m.waitLine} role="status">
        <i className={m.spinner} aria-hidden="true" />
        {product.pendingHash
          ? "Waiting for the network to confirm it."
          : "Waiting for your wallet. If you closed its window, reopen the request below."}
      </p>
      <div className={m.actions}>
        {product.pendingHash && (
          <a
            className={m.ghost}
            href={`${product.pendingExplorer}/tx/${product.pendingHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View transaction ↗
          </a>
        )}
        {product.pendingHash && (
          <button className={m.ghost} onClick={product.recover} disabled={model.busy}>
            Check now
          </button>
        )}
        {typeof product.retry === "function" && (
          <button className={m.ghost} onClick={product.retry} disabled={model.busy || model.loading}>
            Reopen in wallet
          </button>
        )}
      </div>
      <details
        className={m.help}
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>Sped it up or cancelled it in your wallet?</summary>
        <p>
          Paste the hash of the transaction your wallet shows now. It is checked
          against this wallet and this step before anything continues.
          {typeof product.retry === "function" &&
            " Reopening the request sends the same one again with the same number, so it can only ever run once."}
        </p>
        <div className={m.hashRow}>
          <input
            aria-label="Transaction hash"
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            value={product.recoveryHash ?? ""}
            onChange={(event) => product.setRecoveryHash?.(event.target.value)}
            disabled={model.busy}
          />
          <button
            className={m.ghost}
            onClick={product.recover}
            disabled={model.busy || !product.recoveryHash?.trim()}
          >
            Check transaction
          </button>
        </div>
      </details>
    </div>
  );
}

// A reading the next step depends on did not come back. Nothing is assumed.
function Recheck({ model, text }) {
  return (
    <>
      <p role="status">{text}</p>
      <div className={m.actions}>
        <button className={m.ghost} onClick={model.refresh} disabled={model.loading}>
          {model.loading ? "Reading…" : "Read again"}
        </button>
      </div>
    </>
  );
}

function CopyAddress({ address }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={m.copy}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* The address is on screen to copy by hand. */
        }
      }}
    >
      <code>{address}</code>
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

// One previous vault and its way into the product.
function Move({ product, model, vault, eth }) {
  const fromArbitrum = product.chainId !== 8453;
  const withdrawn = whole(product.withdrawn) ?? 0n;
  // "check" means a reading is missing. Before anything was withdrawn that is
  // the position in the previous vault; after, it is the wallet on Base.
  const rechecking = product.stage === "check" && withdrawn > 0n;
  const step = rechecking
    ? fromArbitrum
      ? "bring"
      : "deposit"
    : STEP_OF[product.stage] || "withdraw";
  const order = fromArbitrum
    ? ["withdraw", "bring", "deposit", "settle", "collect"]
    : ["withdraw", "deposit", "settle", "collect"];
  // A Base vault pays out on Base, so "bring" only means the money is not in
  // the wallet any more: it shows inside the deposit step.
  const at = step === "done" ? order.length : order.indexOf(step === "bring" && !fromArbitrum ? "deposit" : step);
  const stateOf = (name) => {
    const i = order.indexOf(name);
    if (i < at) return "done";
    if (i > at) return "next";
    return ["withdraw_pending", "deposit_pending", "settlement", "recover"].includes(product.stage) ||
      (product.stage === "check" && !rechecking && product.positionStatus !== "error")
      ? "waiting"
      : "current";
  };
  const number = (name) => order.indexOf(name) + 1;
  const ready = product.positionStatus === "ready";
  const remaining = whole(product.amount) ?? 0n;
  const credited = whole(product.credited) ?? 0n;
  const inVault = ready && (whole(product.shares) ?? 0n) > 0n ? (whole(product.assets) ?? 0n) : 0n;
  const selected = whole(product.selected) ?? remaining;
  const cash = whole(product.cash);
  const additional = whole(product.additionalFunds) ?? 0n;
  const room =
    vault.batchRoom == null ? null : BigInt(Math.floor(vault.batchRoom * 1e6));
  const overRoom = room != null && selected > room;
  const closing = batchClosing(vault);
  const noGas = /^\d+$/.test(String(eth ?? "")) && BigInt(eth) === 0n;
  const txOf = (...labels) =>
    (product.txs || []).filter((row) => labels.some((label) => row.label.startsWith(label)));
  const acting = model.busy;
  const error = product.error || product.positionError;
  // The bridge step asks for nothing to sign: it waits for USDC to arrive.
  const need = selected > 0n ? selected : remaining;
  const short_ = cash != null && need > cash ? need - cash : 0n;
  const minimum = whole(product.minDeposit) ?? 0n;
  // A bridge keeps a fee, so a little less than was withdrawn arrives. When
  // nearly all of it is on Base the move goes on with what arrived, once, and
  // only if the holder has not typed an amount of their own.
  const nearly =
    product.stage === "base" &&
    cash != null &&
    cash >= minimum &&
    cash > 0n &&
    short_ > 0n &&
    short_ * 20n <= need;
  const proposed = useRef(false);
  useEffect(() => {
    if (!nearly || proposed.current || product.amountInput) return;
    proposed.current = true;
    product.setAmountInput(exact(cash < remaining ? cash : remaining));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearly]);
  // Some is on Base, clearly not all of it: the holder may go on with that.
  const partly =
    product.stage === "base" && cash != null && cash >= minimum && cash > 0n && !nearly;
  const canFinish =
    ["base", "approve", "deposit"].includes(product.stage) && inVault === 0n && withdrawn > 0n;

  return (
    <article className={m.move} aria-labelledby={"move-" + product.id}>
      <header className={m.moveHead}>
        <div className={m.route}>
          <div className={m.routeEnd}>
            <span>From</span>
            <strong id={"move-" + product.id}>
              <NetworkMarks networks={[product.name]} size={16} />
              USDC on {product.name}
            </strong>
            <small>Previous vault</small>
          </div>
          <svg className={m.routeArrow} viewBox="0 0 48 16" width="48" height="16" aria-hidden="true">
            <path d="M1 8h44M38 2l7 6-7 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className={m.routeEnd}>
            <span>To</span>
            <strong>
              <TokenMark token="USDC" size={16} />
              {vault.title}
            </strong>
            <small>Deposits on Base</small>
          </div>
        </div>
        <dl className={m.tally}>
          <div>
            <dt>In the previous vault</dt>
            <dd>{ready ? usdc(inVault) : "—"}</dd>
          </div>
          <div>
            <dt>Waiting to be deposited</dt>
            <dd>{usdc(remaining)}</dd>
          </div>
          <div>
            <dt>Moved so far</dt>
            <dd>{usdc(credited)}</dd>
          </div>
        </dl>
      </header>

      {error && !["base", "approve", "deposit", "claim"].includes(product.stage) && (
        <p className={m.alert} role="alert">
          {error}
        </p>
      )}
      {product.message && !error && (
        <p className={m.said} role="status">
          {product.message}
        </p>
      )}

      <ol className={m.steps}>
        <Step
          index={number("withdraw")}
          state={stateOf("withdraw")}
          title="Withdraw from the previous vault"
          summary={
            stateOf("withdraw") === "done"
              ? `${usdc(withdrawn)} USDC arrived in your wallet on ${product.name}.`
              : null
          }
        >
          {product.stage === "check" ? (
            <>
              <p role="status">
                {product.positionStatus === "error"
                  ? "Your position could not be read from the network. Nothing is assumed about it until it can."
                  : "Reading your position from the vault’s contract…"}
              </p>
              {product.positionStatus === "error" && (
                <div className={m.actions}>
                  <button className={m.primary} onClick={model.refresh} disabled={model.loading}>
                    Read again
                  </button>
                </div>
              )}
            </>
          ) : product.stage === "withdraw_pending" ? (
            <Unresolved product={product} model={model} />
          ) : (
            <>
              <p>
                Takes your whole balance, <strong>{usdc(inVault)} USDC</strong>,
                out of the previous vault and into your wallet on {product.name}.
                One confirmation in your wallet. The amount you receive is read
                from the confirmed transaction.
              </p>
              <div className={m.actions}>
                <button className={m.primary} onClick={product.act} disabled={!product.canAct || acting}>
                  {acting ? "Check your wallet…" : `Withdraw ${usdc(inVault)} USDC`}
                </button>
                <span className={m.aside}>Network fee in ETH on {product.name}</span>
              </div>
            </>
          )}
        </Step>

        {fromArbitrum && (
          <Step
            index={number("bring")}
            state={stateOf("bring")}
            title="Send your USDC to Base"
            summary={
              stateOf("bring") === "done"
                ? "Your USDC is on Base."
                : "The new vault takes deposits on Base, so the USDC from Arbitrum goes there first."
            }
          >
            {rechecking ? (
              <Recheck model={model} text="Reading your wallet on Base…" />
            ) : (
            <>
            <p>
              The new vault takes deposits on Base. Send{" "}
              <strong>{usdc(short_ > 0n ? short_ : need)} USDC</strong> from
              Arbitrum to <strong>the same wallet on Base</strong>. The bridge
              in your wallet does this in a few minutes: choose USDC on
              Arbitrum, USDC on Base, and your own address.
            </p>
            <div className={m.bridge}>
              <div>
                <span>Send to, on Base</span>
                <CopyAddress address={model.owner} />
              </div>
              <dl>
                <div>
                  <dt>USDC on Base now</dt>
                  <dd>{cash == null ? "—" : usdc(cash)}</dd>
                </div>
                <div>
                  <dt>Needed to continue</dt>
                  <dd>{usdc(need)}</dd>
                </div>
              </dl>
            </div>
            <p className={m.waitLine} role="status">
              <i className={m.spinner} aria-hidden="true" />
              Watching your Base balance. This step finishes by itself when the
              USDC arrives.
            </p>
            <div className={m.actions}>
              <button className={m.ghost} onClick={model.refresh} disabled={model.loading || acting}>
                {model.loading ? "Checking…" : "Check now"}
              </button>
              {partly && fromArbitrum && (
                <button
                  className={m.ghost}
                  onClick={() => product.setAmountInput(exact(cash < remaining ? cash : remaining))}
                  disabled={acting}
                >
                  Deposit the {usdc(cash)} USDC already on Base
                </button>
              )}
            </div>
            <details className={m.help}>
              <summary>Less arrived than you sent?</summary>
              <p>
                Bridges take a small fee. Type the amount that arrived and
                continue with that. The move counts what you deposit; the
                difference stays shown as not moved.
              </p>
              <AmountField product={product} model={model} cash={cash} id={"amount-bring-" + product.id} />
            </details>
            {noGas && (
              <p className={m.note}>
                You have no ETH on Base yet. The deposit needs a little for
                network fees, so bring some along.
              </p>
            )}
            </>
            )}
          </Step>
        )}

        <Step
          index={number("deposit")}
          state={stateOf("deposit")}
          title={`Deposit into ${vault.title}`}
          summary={
            stateOf("deposit") === "done"
              ? `${usdc(credited)} USDC requested.`
              : "Two confirmations on Base: approve the exact amount, then request the deposit."
          }
        >
          {["deposit_pending", "recover"].includes(product.stage) ? (
            <Unresolved product={product} model={model} />
          ) : rechecking ? (
            <Recheck model={model} text="Reading your wallet on Base…" />
          ) : (
            <>
              {product.stage === "base" && !fromArbitrum && (
                <p className={m.alert} role="alert">
                  {error ||
                    "Your wallet on Base holds less USDC than this move needs. Add USDC or lower the amount."}
                </p>
              )}
              <AmountField product={product} model={model} cash={cash} id={"amount-" + product.id} />
              {selected < remaining &&
                !overRoom &&
                (cash != null && selected >= cash ? (
                  <p className={m.note}>
                    {usdc(remaining - selected, remaining - selected < 10000n ? 6 : 2)}{" "}
                    USDC less than you withdrew is on Base. If the rest was
                    the bridge’s fee, the move finishes with this deposit.
                  </p>
                ) : (
                  <p className={m.note}>
                    The other {usdc(remaining - selected)} USDC stays in your
                    wallet for a later batch.
                  </p>
                ))}
              {additional > 0n && (
                <p className={m.note}>
                  {usdc(product.migrationCredit)} USDC from your move and{" "}
                  {usdc(additional)} USDC more from your wallet.
                </p>
              )}
              {overRoom && (
                <div className={m.cap} role="status">
                  <p>
                    The vault takes up to {money(vault.batchLimit, 0)} USDC per
                    batch for now, and this batch has room for{" "}
                    <strong>{usdc(room)} USDC</strong>. Deposit that now; the
                    rest stays in your wallet and goes in with the next batch.
                  </p>
                  {room > 0n && (
                    <button
                      className={m.ghost}
                      onClick={() => product.setAmountInput(exact(room))}
                      disabled={acting}
                    >
                      Use {usdc(room)} USDC
                    </button>
                  )}
                </div>
              )}
              <ol className={m.pair}>
                <li data-state={product.stage === "approve" ? "current" : product.stage === "deposit" ? "done" : "next"}>
                  <span>Approve exactly {usdc(selected)} USDC</span>
                  {product.stage === "approve" && (
                    <button
                      className={m.primary}
                      onClick={product.act}
                      disabled={!product.canAct || acting || overRoom}
                    >
                      {acting ? "Check your wallet…" : "Approve USDC"}
                    </button>
                  )}
                </li>
                <li data-state={product.stage === "deposit" ? "current" : "next"}>
                  <span>Request the deposit</span>
                  {product.stage === "deposit" && (
                    <button
                      className={m.primary}
                      onClick={product.act}
                      disabled={!product.canAct || acting || overRoom}
                    >
                      {acting ? "Check your wallet…" : `Deposit ${usdc(selected)} USDC`}
                    </button>
                  )}
                </li>
              </ol>
              {error && ["approve", "deposit"].includes(product.stage) && (
                <p className={m.alert} role="alert">
                  {error}
                </p>
              )}
              {noGas && (
                <p className={m.note}>
                  You have no ETH on Base. Add a little for network fees first.
                </p>
              )}
            </>
          )}
        </Step>

        <Step
          index={number("settle")}
          state={stateOf("settle")}
          title="The batch settles"
          summary={
            stateOf("settle") === "done"
              ? "Settled."
              : "Deposits are settled together at the vault’s next valuation, usually within one to two hours."
          }
        >
          <p role="status">
            Your USDC is in the open batch
            {product.requestId != null ? `, request #${product.requestId}` : ""}.
            It settles at the vault’s next valuation and starts earning then.
            {closing && !closing.late ? " " + closing.text : ""}
          </p>
          <p className={m.note}>
            Nothing to do in the meantime. You can close this page and come
            back: progress is read from the chain.
          </p>
        </Step>

        <Step
          index={number("collect")}
          state={stateOf("collect")}
          title="Collect your shares"
          summary="One confirmation puts the vault’s shares in your wallet."
        >
          <p>
            The batch settled and your deposit is earning. Collect your shares
            to finish
            {remaining > 0n ? " this part of the move" : " the move"}.
          </p>
          <div className={m.actions}>
            <button className={m.primary} onClick={product.act} disabled={!product.canAct || acting}>
              {acting ? "Check your wallet…" : "Collect shares"}
            </button>
          </div>
          {error && (
            <p className={m.alert} role="alert">
              {error}
            </p>
          )}
        </Step>
      </ol>

      {canFinish && (
        <p className={m.finish}>
          Keeping the remaining {usdc(remaining, remaining < 10000n ? 6 : 2)} USDC
          in your wallet?{" "}
          <button className={m.textLink} onClick={() => finishMove(model.owner, product)}>
            Finish the move here
          </button>
        </p>
      )}
      <TxLinks rows={product.txs} />
      <a
        className={m.contract}
        href={`${product.explorer}/address/${product.address}`}
        target="_blank"
        rel="noreferrer"
      >
        Previous vault contract {short(product.address)} ↗
      </a>
    </article>
  );
}

function AmountField({ product, model, cash, id }) {
  const selected = product.selected || product.amount;
  return (
    <div className={m.amount}>
      <label htmlFor={id}>Amount to deposit</label>
      <div className={m.amountBox}>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder={exact(selected) || "0.00"}
          value={product.amountInput ?? ""}
          onChange={(event) => product.setAmountInput(event.target.value)}
          disabled={model.busy}
        />
        <span>USDC</span>
        <button
          type="button"
          onClick={() => product.setAmountInput(exact(cash))}
          disabled={model.busy || cash == null || cash === 0n}
        >
          Max
        </button>
      </div>
      <p className={m.amountHint}>
        {cash == null ? "Reading your Base wallet…" : `${usdc(cash)} USDC in your wallet on Base.`}
        {product.minDeposit != null && whole(product.minDeposit) > 0n
          ? ` Minimum ${usdc(product.minDeposit)}.`
          : ""}
      </p>
    </div>
  );
}

// A previous vault on a network the move does not cover: the holder withdraws
// to their wallet, in that vault's own token.
function WithdrawOnly({ vault, account, owner }) {
  const [open, setOpen] = useState(false);
  const [, setLocked] = useState(false);
  const definition = getVault(vault.id);
  const position = account.vaults.find((row) => row.id === vault.id);
  const pending = account.transactions.find(
    (tx) => tx.vaultId === vault.id && ["pending", "unknown"].includes(tx.status),
  );
  return (
    <li className={m.other}>
      <div className={m.otherRow}>
        <strong>
          <NetworkMarks networks={[vault.place]} size={16} />
          {vault.title}
        </strong>
        <span>
          {money(vault.position.balance)} {vault.token}
        </span>
        <button className={m.ghost} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Close" : "Withdraw"}
        </button>
      </div>
      {open && (
        <div className={m.otherForm}>
          <TransactionPanel
            embedded
            vault={definition}
            position={position}
            account={account}
            owner={owner}
            mode="withdraw"
            setMode={() => {}}
            setLocked={setLocked}
            pending={pending}
            onFunding={() => {}}
          />
        </div>
      )}
    </li>
  );
}

function Destination({ book, onOpen }) {
  const vault = book.vault;
  const closing = batchClosing(vault);
  return (
    <aside className={m.destination} aria-label="The new vault">
      <span className={m.eyebrow}>Where your money goes</span>
      <h2>
        <TokenMark token="USDC" size={28} />
        {vault.title}
      </h2>
      <p>{vault.product.line}</p>
      <dl>
        <div>
          <dt>Rate now</dt>
          <dd>{pct(vault.rateNow)}</dd>
          <small>
            {book.index?.rateNow != null
              ? `Market Average ${pct(book.index.rateNow)}`
              : "quoted by its markets"}
          </small>
        </div>
        <div>
          <dt>Lends on</dt>
          <dd>{vault.networks.join(" and ")}</dd>
          <small>one balance for you, on Base</small>
        </div>
        <div>
          <dt>Batches</dt>
          <dd>Every 1 to 2 hours</dd>
          <small>{closing && !closing.late ? closing.text : "when a fresh valuation is published"}</small>
        </div>
        {vault.batchLimit != null && (
          <div>
            <dt>Per batch</dt>
            <dd>Up to {money(vault.batchLimit, 0)} USDC</dd>
            <small>
              {vault.batchRoom != null ? `${money(vault.batchRoom)} USDC of room now` : ""}
            </small>
          </div>
        )}
      </dl>
      <ul className={m.know}>
        {(vault.notice || []).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <button className={m.textLink} onClick={() => onOpen("earn")}>
        Everything about the vault
      </button>
    </aside>
  );
}

const QUESTIONS = [
  [
    "Is my money safe while it is still in the previous vault?",
    "Yes. It stays in that vault’s contract under your wallet and you can withdraw it at any time. Nothing moves until you confirm a transaction.",
  ],
  [
    "Why do I have to move it myself?",
    "Thesauros never holds your keys, so only you can take money out of one vault and put it into another. Each step is a transaction your wallet shows you before you confirm.",
  ],
  [
    "What if I close the page halfway?",
    "Nothing is lost. Every step is checked on the chain, so this page picks up where you left off, on any visit from the same browser. From another browser, use the transaction hash from your wallet.",
  ],
  [
    "Do I have to move everything at once?",
    "No. You can deposit part of what you withdrew and the rest later. While the vault takes a limited amount per batch, larger moves go in over several batches.",
  ],
];

export default function MoveApp({
  mode,
  user,
  book,
  migration,
  finished,
  account,
  batch,
  displayName,
  onBack,
  onOpen,
}) {
  const owner = user?.walletAddress;
  useEffect(() => {
    document.title = "Thesauros · Move to the new vault";
  }, []);
  const products = migration.products || [];
  const others = useMemo(
    () => book.account.previous.filter((vault) => !MIGRATION_VAULT_IDS.includes(vault.id)),
    [book.account.previous],
  );
  const active = products.filter((product) => !isFinished(product, finished));
  const complete = products.filter((product) => isFinished(product, finished));
  const [picked, setPicked] = useState(null);
  const shown =
    active.find((product) => product.id === picked) ||
    active.find((product) => product.recovery) ||
    active[0] ||
    null;
  const reading =
    !!owner && migration.loading && !products.some((product) => product.positionStatus === "ready");
  const eth = batch.feed?.user?.eth;
  return (
    <div className={`${b.app} ${m.app}`}>
      <header className={m.top}>
        <a className={m.brand} href={marketingHref("/")}>
          <img src="/brand/mark.svg" width="26" height="26" alt="" />
          Thesauros
        </a>
        <div className={m.topRight}>
          <a
            className={m.back}
            href={"/app/" + mode}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              onBack();
            }}
          >
            Back to the app
          </a>
          {displayName ? (
            <span className={m.wallet}>{displayName}</span>
          ) : (
            <ConnectAction className={m.primary} />
          )}
        </div>
      </header>
      <main className={m.main}>
        <div className={m.intro}>
          <span className={m.eyebrow}>Previous vaults</span>
          <h1 tabIndex={-1}>Move to the new vault</h1>
          <p>
            Thesauros now runs on one vault that lends across networks, instead
            of a separate vault on each. Money in the previous vaults stays
            yours. Moving it takes a few transactions, each one confirmed in
            your wallet.
          </p>
        </div>
        <div className={m.layout}>
          <div className={m.column}>
            {!user ? (
              <section className={m.empty}>
                <h2>Connect the wallet you used with Thesauros</h2>
                <p>
                  The app reads that wallet’s positions in the previous vaults
                  and walks you through the move. Signing in moves no funds and
                  grants no approvals.
                </p>
                <ConnectAction className={m.primary} label="Connect wallet" />
              </section>
            ) : !owner ? (
              <section className={m.empty}>
                <h2>Link your treasury wallet first</h2>
                <p>
                  The move is signed by the wallet that holds the position.
                </p>
                <button className={m.primary} onClick={() => onOpen("settings")}>
                  Link a wallet
                </button>
              </section>
            ) : (
              <>
                {migration.storageError && (
                  <p className={m.alert} role="alert">
                    {migration.storageError}
                  </p>
                )}
                {reading && (
                  <section className={m.empty} role="status">
                    <h2>Reading your positions…</h2>
                    <p>Checking the previous vaults on Arbitrum and Base for this wallet.</p>
                  </section>
                )}
                {active.length > 1 && (
                  <div className={m.tabs} role="tablist" aria-label="Previous vaults to move">
                    {active.map((product) => (
                      <button
                        key={product.id}
                        role="tab"
                        aria-selected={shown?.id === product.id}
                        onClick={() => setPicked(product.id)}
                      >
                        <NetworkMarks networks={[product.name]} size={16} />
                        USDC on {product.name}
                        <small>
                          {usdc(
                            (whole(product.shares) ?? 0n) > 0n ? product.assets : product.amount,
                          )}{" "}
                          USDC
                        </small>
                      </button>
                    ))}
                  </div>
                )}
                {shown && (
                  <Move
                    key={owner + shown.id}
                    product={shown}
                    model={migration}
                    vault={book.vault}
                    eth={eth}
                  />
                )}
                {complete.map((product) => (
                  <section key={product.id} className={m.done} role="status">
                    <Mark state="done" />
                    <div>
                      <h2>Moved from {product.name}</h2>
                      <p>
                        {usdc(product.credited)} USDC from the previous vault is
                        now in {book.vault.title}.
                        {(whole(product.amount) ?? 0n) > 0n
                          ? ` ${usdc(product.amount, (whole(product.amount) ?? 0n) < 10000n ? 6 : 2)} USDC of what you withdrew was not deposited.`
                          : ""}
                      </p>
                      <TxLinks rows={product.txs} />
                    </div>
                  </section>
                ))}
                {others.length > 0 && (
                  <section className={m.others}>
                    <h2>Previous vaults on other networks</h2>
                    <p>
                      These take no new deposits. Withdraw to your wallet at any
                      time. The new vault takes USDC on Base.
                    </p>
                    <ul>
                      {others.map((vault) => (
                        <WithdrawOnly key={vault.id} vault={vault} account={account} owner={owner} />
                      ))}
                    </ul>
                  </section>
                )}
                {!reading && !active.length && !others.length && (
                  <section className={m.empty}>
                    <h2>
                      {complete.length ? "Nothing left to move" : "Nothing to move"}
                    </h2>
                    <p>
                      {complete.length
                        ? "This wallet has no money left in a previous vault."
                        : "This wallet has no money in a previous vault. If you used another wallet, connect that one."}
                    </p>
                    <div className={m.actions}>
                      <button className={m.primary} onClick={() => onOpen("overview")}>
                        Open your portfolio
                      </button>
                      <button className={m.ghost} onClick={() => onOpen("earn")}>
                        See the vault
                      </button>
                    </div>
                  </section>
                )}
              </>
            )}
            <section className={m.questions}>
              <h2>Good to know</h2>
              {QUESTIONS.map(([question, answer]) => (
                <details key={question}>
                  <summary>{question}</summary>
                  <p>{answer}</p>
                </details>
              ))}
              <p className={m.support}>
                Stuck on a step?{" "}
                <a href={marketingHref("/contact")}>Contact support</a> or read{" "}
                <a href={documentationHref("/customer/move")}>the guide to moving</a>.
              </p>
            </section>
          </div>
          <Destination book={book} onOpen={onOpen} />
        </div>
      </main>
    </div>
  );
}
