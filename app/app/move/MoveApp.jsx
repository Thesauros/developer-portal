"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { getVault } from "../../../lib/vault-contracts.mjs";
import { MIGRATION_VAULT_IDS } from "../../../lib/migration-state.mjs";
import { marketingHref, documentationHref } from "../../../lib/site-links.mjs";
import { ConnectAction } from "../wallet/WalletAccess";
import { keepRest, resumeMove } from "./kept";
import { TransactionPanel } from "../book/InstantTransaction";
import { batchClosing } from "../book/ActionPanel";
import { money, pct, short, NetworkMarks, TokenMark } from "../book/parts";
import b from "../book/book.module.css";
import m from "./move.module.css";

// Token units as the amount a person reads, to two decimals. `precise` is for
// an amount about to be signed: it shows every digit that is not zero, so the
// screen never names a rounder figure than the wallet will.
const whole = (value) =>
  /^\d+$/.test(String(value ?? "")) ? BigInt(value) : null;
const usdc = (value, digits = 2) => {
  const units = whole(value);
  return units == null ? "—" : money(Number(units) / 1e6, digits);
};
const precise = (value) => {
  const units = whole(value);
  if (units == null) return "—";
  if (units % 10000n === 0n) return money(Number(units) / 1e6);
  const [int, fraction = ""] = exact(units).split(".");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + fraction.padEnd(2, "0");
};
// A typed amount as token units, or null when it is not an amount.
const toUnits = (text) => {
  const value = String(text ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return null;
  const [int, fraction = ""] = value.split(".");
  return BigInt(int) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
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
            " The app checks whether the saved request can be safely reopened before asking your wallet."}
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

// "1 to 2 hours", from the open batch's own limits.
function batchHours(vault) {
  const epoch = vault.epoch;
  if (!epoch?.openedAt || !epoch.earliestCloseAt || !epoch.latestCloseAt) return null;
  const min = (epoch.earliestCloseAt - epoch.openedAt) / 3600;
  const max = (epoch.latestCloseAt - epoch.openedAt) / 3600;
  return min > 0 && max >= min ? { min, max } : null;
}
const span = (hours) => {
  const days = hours / 24;
  return days >= 2 ? `${Math.round(days)} days` : `${Math.round(hours)} hours`;
};

// A transport error is the library's wording, not ours: say what it means.
function plain(error, network) {
  const text = String(error || "");
  if (!text) return "";
  return /HTTP request failed|fetch failed|Failed to fetch|timed out|timeout|network error|ECONN|socket/i.test(text)
    ? `${network || "The network"} did not answer just now. Nothing was sent and nothing is assumed. Try again in a minute.`
    : text;
}

// What a large move means at today's limit, said before anything is withdrawn.
function Plan({ amount, vault }) {
  const limit = vault.batchLimit;
  if (limit == null || !(amount > limit)) return null;
  const rounds = Math.ceil(amount / limit);
  const hours = batchHours(vault);
  return (
    <div className={m.plan} role="note">
      <strong>At today’s limit this is a long move.</strong>
      <p>
        The new vault takes up to {money(limit, 0)} USDC per batch, shared by
        everyone, and a batch closes every{" "}
        {hours ? `${hours.min} to ${hours.max} hours` : "few hours"}. Your{" "}
        {money(amount, 0)} USDC would need at least {rounds} batches
        {hours ? `: ${span(rounds * hours.min)} to ${span(rounds * hours.max)} of repeating these steps` : ""}.
      </p>
      <p>
        What you withdraw and have not deposited yet sits in your wallet and
        earns nothing. So move in parts: take out only what the next batch can
        take, and leave the rest earning in the previous vault. The limit is
        read from the contract; this page shows it as it changes.
      </p>
    </div>
  );
}

// Where this move's money is right now. Every dollar is in one place.
function Where({ product, places }) {
  return (
    <dl className={m.tally}>
      {places.map(([label, value, note]) => (
        <div key={label} data-empty={value === 0n || undefined}>
          <dt>{label}</dt>
          <dd>{value == null ? "—" : usdc(value)}</dd>
          <small>{note}</small>
        </div>
      ))}
    </dl>
  );
}

// One previous vault and its way into the product.
function Move({ product, model, vault, eth, batch }) {
  const fromArbitrum = product.chainId !== 8453;
  const withdrawn = whole(product.withdrawn) ?? 0n;
  // "check" means a reading is missing. Before anything was withdrawn that is
  // the position in the previous vault; after, it is the wallet on Base.
  const rechecking = product.stage === "check" && withdrawn > 0n;
  const [typed, setTyped] = useState(false);
  const step = rechecking
    ? fromArbitrum
      ? "bring"
      : "deposit"
    : product.stage === "recover"
      ? product.pendingKind === "claim"
        ? "collect"
        : "deposit"
      : // While the holder is typing an amount the form stays where it is,
        // whatever the amount means for the stage.
        product.stage === "base" && (typed || !!product.amountInput)
        ? "deposit"
        : STEP_OF[product.stage] || "withdraw";
  const order = fromArbitrum
    ? ["withdraw", "bring", "deposit", "settle", "collect"]
    : ["withdraw", "deposit", "settle", "collect"];
  // A Base vault pays out on Base, so "bring" only means the money is not in
  // the wallet any more: it shows inside the deposit step.
  const at = order.indexOf(step === "bring" && !fromArbitrum ? "deposit" : step);
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
  const queued = whole(product.queued) ?? 0n;
  const inVault = ready && (whole(product.shares) ?? 0n) > 0n ? (whole(product.assets) ?? 0n) : 0n;
  const selected = whole(product.selected) ?? remaining;
  const cash = whole(product.cash);
  const additional = whole(product.additionalFunds) ?? 0n;
  const knownMinimum = whole(product.minDeposit);
  const minimum = knownMinimum ?? 0n;
  const limit = vault.batchLimit == null ? null : BigInt(Math.round(vault.batchLimit * 1e6));
  const room = vault.batchRoom == null ? null : BigInt(Math.round(vault.batchRoom * 1e6));
  const closing = batchClosing(vault);
  const noGas = /^\d+$/.test(String(eth ?? "")) && BigInt(eth) === 0n;
  const acting = model.busy;
  const error = plain(product.error || product.positionError, product.name);

  // Step 1. A balance larger than a batch can take is moved in parts: what the
  // open batch has room for, or a whole batch when this one is full.
  const large = limit != null && inVault > limit;
  const round = room != null && room >= minimum && room > 0n ? room : limit;
  const [everything, setEverything] = useState(false);
  useEffect(() => {
    if (product.stage !== "withdraw") {
      if (everything) setEverything(false);
      return;
    }
    if (large && !everything && !product.withdrawInput && round != null)
      product.setWithdrawInput(exact(inVault < round ? inVault : round));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.stage, large, everything, product.withdrawInput, round, inVault]);
  const part = product.withdrawInput ? toUnits(product.withdrawInput) : null;
  const taking = part ?? inVault;
  const withdrawReady = !large || everything || !!product.withdrawInput;
  const withdrawProblem =
    product.withdrawInput && (part == null || part <= 0n || part > inVault)
      ? "Enter an amount, with up to 6 decimals, no larger than your balance in the previous vault."
      : "";

  // Step 3. The amount follows what can actually go in now: what is waiting,
  // what is on Base, and what the open batch has room for. The holder can
  // still type their own.
  const need = selected > 0n ? selected : remaining;
  const onBase = cash ?? 0n;
  const fits = [remaining, onBase, ...(room != null ? [room] : [])].reduce((a, c) => (c < a ? c : a));
  // A wallet balance proves what can be deposited, not which transfer funded
  // it. Any verified amount meeting the minimum can continue this move.
  const fundable = knownMinimum != null && cash != null && cash > 0n && cash >= minimum;
  const topUp = cash != null && cash < minimum ? minimum - cash : 0n;
  const full = room != null && room < (minimum > 0n ? minimum : 1n);
  // The amount this screen filled in itself; it follows the room and the
  // balance as they change, until the holder types their own.
  const filled = useRef("");
  useEffect(() => {
    setTyped(false);
    filled.current = "";
  }, [model.owner, product.id]);
  useEffect(() => {
    if (!["base", "approve", "deposit"].includes(product.stage)) {
      if (typed) setTyped(false);
      filled.current = "";
      return;
    }
    if (typed || full || !fundable) return;
    if (product.amountInput && product.amountInput !== filled.current) return;
    const next = fits >= minimum && fits > 0n && fits !== remaining ? exact(fits) : "";
    if (next !== (product.amountInput || "")) {
      filled.current = next;
      product.setAmountInput(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.stage, typed, product.amountInput, full, fundable, fits, remaining, minimum]);
  const left = whole(product.left) ?? 0n;
  const keptBack = left > 0n && left >= minimum;
  const overRoom = room != null && selected > room;
  const later = remaining > selected ? remaining - selected : 0n;
  // Show the depositable part on Base without inferring a bridge fee from the
  // difference. The remaining migration credit still follows confirmed receipts.
  const held =
    cash != null && cash < remaining && (fundable || remaining < minimum) ? cash : remaining;
  const rest = held > selected ? held - selected : 0n;

  // Stopping: the rest stays in the wallet. Asked twice, undone from the page.
  const canStop =
    ["base", "approve", "deposit"].includes(product.stage) && remaining > 0n && !acting;
  const [stopping, setStopping] = useState(false);

  // When the move goes on to another step, the card's top comes back into
  // view: the four figures there are what tells the holder what just happened.
  const card = useRef(null);
  const lastStep = useRef(step);
  useEffect(() => {
    if (lastStep.current === step) return;
    lastStep.current = step;
    // Only when the holder is looking at this card below its top; someone
    // reading further down the page is left where they are.
    const box = card.current?.getBoundingClientRect();
    if (box && box.top < 0 && box.bottom > 160)
      card.current.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [step]);
  // A part is done and more is waiting in the previous vault.
  const moved = credited > queued ? credited - queued : 0n;
  const partDone = product.stage === "withdraw" && moved > 0n && inVault > 0n && remaining === 0n;
  // Figures that could not be read are not shown as zero.
  const unread = product.stage === "check" || product.positionStatus === "error";

  const request =
    product.requestId != null
      ? (batch.feed?.user?.requests || []).find(
          (item) => String(item.id) === String(product.requestId),
        )
      : null;

  return (
    <article ref={card} className={m.move} aria-labelledby={"move-" + product.id}>
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
        <Where
          product={product}
          places={[
            ["In the previous vault", ready ? inVault : null, inVault > 0n ? "earning there" : ""],
            ["In your wallet", unread ? null : held, held > 0n ? "withdrawn, not deposited yet" : ""],
            ["In the open batch", unread ? null : queued, queued > 0n ? "waiting to settle or be collected" : ""],
            ["In the new vault", unread ? null : moved, moved > 0n ? "moved" : ""],
          ]}
        />
      </header>

      {keptBack && (
        <p className={m.keptLine}>
          {usdc(left)} USDC you withdrew earlier is kept in your wallet and is
          not part of this move.{" "}
          <button className={m.textLink} onClick={() => resumeMove(model.owner, product.id)}>
            Bring it back
          </button>
        </p>
      )}
      {error && !["base", "approve", "deposit", "claim", "withdraw"].includes(product.stage) && (
        <p className={m.alert} role="alert">
          {error}
        </p>
      )}
      {partDone && (
        <p className={m.partDone} role="status">
          <strong>{usdc(moved)} USDC is in the new vault.</strong>{" "}
          {usdc(inVault)} USDC is still earning in the previous vault: take out
          the next part when you are ready.
        </p>
      )}
      {product.message && !error && !partDone && (
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
              ? `${usdc(withdrawn)} USDC withdrawn to your wallet on ${product.name}${inVault > 0n ? `; ${usdc(inVault)} USDC still earning in the previous vault` : ""}.`
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
          ) : large ? (
            <>
              <Plan amount={Number(inVault) / 1e6} vault={vault} />
              {everything ? (
                <p>
                  Takes your whole balance, <strong>{usdc(inVault)} USDC</strong>,
                  into your wallet on {product.name}. What does not fit the
                  next batch waits there, earning nothing, until later batches.{" "}
                  <button className={m.textLink} onClick={() => setEverything(false)}>
                    Move in parts instead
                  </button>
                </p>
              ) : (
                <>
                  <div className={m.amount}>
                    <label htmlFor={"withdraw-" + product.id}>Take out now</label>
                    <div className={m.amountBox}>
                      <input
                        id={"withdraw-" + product.id}
                        inputMode="decimal"
                        autoComplete="off"
                        value={product.withdrawInput ?? ""}
                        onChange={(event) => product.setWithdrawInput(event.target.value)}
                        disabled={acting}
                      />
                      <span>USDC</span>
                    </div>
                    <p className={m.amountHint}>
                      {room != null && room >= minimum && room > 0n
                        ? `The open batch has room for ${usdc(room)} USDC. `
                        : limit != null
                          ? `The open batch is full; the next one takes up to ${usdc(limit)} USDC. `
                          : ""}
                      The other {usdc(inVault > taking ? inVault - taking : 0n)} USDC
                      stays in the previous vault, earning.
                    </p>
                  </div>
                </>
              )}
              {(withdrawProblem || (error && product.stage === "withdraw")) && (
                <p className={m.alert} role="alert">
                  {withdrawProblem || error}
                </p>
              )}
              <div className={m.actions}>
                <button
                  className={m.primary}
                  onClick={product.act}
                  disabled={!product.canAct || acting || !withdrawReady || !!withdrawProblem}
                >
                  {acting
                    ? "Check your wallet…"
                    : everything || taking === inVault
                      ? `Withdraw everything, ${usdc(inVault)} USDC`
                      : `Withdraw ${precise(taking)} USDC`}
                </button>
                <span className={m.aside}>Network fee in ETH on {product.name}</span>
              </div>
              {!everything && (
                <button className={m.textLink} onClick={() => { product.setWithdrawInput(""); setEverything(true); }}>
                  Withdraw everything instead
                </button>
              )}
            </>
          ) : (
            <>
              <p>
                Takes your whole balance, <strong>{usdc(inVault)} USDC</strong>,
                out of the previous vault and into your wallet on {product.name}.
                One confirmation in your wallet. The amount you receive is read
                from the confirmed transaction.
              </p>
              {error && product.stage === "withdraw" && (
                <p className={m.alert} role="alert">
                  {error}
                </p>
              )}
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
                ? "USDC is available in your Base wallet."
                : "The new vault takes deposits on Base, so the USDC from Arbitrum goes there first."
            }
          >
            {rechecking ? (
              <Recheck model={model} text="Reading your wallet on Base…" />
            ) : (
              <>
                <p>
                  Your withdrawal was confirmed on Arbitrum. To continue,
                  transfer USDC to your own wallet on Base. The app does not
                  make this transfer for you. You can deposit the amount that
                  arrives, even if it is less than you withdrew.
                </p>
                <ol className={m.how}>
                  <li>
                    <strong>Open the bridge inside your wallet.</strong>{" "}
                    Do not search for a bridge: fake bridge sites are a common way
                    to lose money.
                  </li>
                  <li>
                    <strong>From USDC on Arbitrum to USDC on Base,</strong> to
                    the same address. The token that must arrive is native
                    USDC, shown below.
                  </li>
                  <li>
                    <strong>Check the fee before you confirm,</strong> and send
                    a small amount first if this is new to you.
                  </li>
                </ol>
                <div className={m.bridge}>
                  <div>
                    <span>Send to, on Base: your own wallet</span>
                    <CopyAddress address={model.owner} />
                  </div>
                  <div>
                    <span>The token that must arrive: USDC on Base</span>
                    <CopyAddress address={model.destination?.asset || ""} />
                  </div>
                  <dl>
                    <div>
                      <dt>USDC on Base now</dt>
                      <dd>{cash == null ? "—" : precise(cash)}</dd>
                    </div>
                    <div>
                      <dt>Withdrawn and not deposited yet</dt>
                      <dd>{precise(remaining)}</dd>
                    </div>
                  </dl>
                  {topUp > 0n && (
                    <p className={m.bridgeNote}>
                      The minimum deposit is {precise(minimum)} USDC. Add at
                      least {precise(topUp)} USDC to your Base wallet to continue.
                    </p>
                  )}
                </div>
                <p className={m.waitLine} role="status">
                  Transfer USDC to Base to continue. Your balance refreshes
                  every 15 seconds and when you return to this page.
                </p>
                <div className={m.actions}>
                  <button className={m.ghost} onClick={model.refresh} disabled={model.loading || acting}>
                    {model.loading ? "Checking…" : "Check Base balance"}
                  </button>
                </div>
                <p className={m.note}>
                  {noGas
                    ? "You have no ETH on Base yet. The deposit needs a little for network fees: send some along."
                    : "The deposit on Base needs a little ETH there for network fees."}{" "}
                  Fees may reduce the amount received. The deposit uses your
                  verified native USDC balance on Base.
                </p>
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
              ? `${usdc(queued > 0n ? queued : credited)} USDC requested.`
              : "Two confirmations on Base: approve the exact amount, then request the deposit."
          }
        >
          {product.stage === "deposit_pending" ||
          (product.stage === "recover" && product.pendingKind !== "claim") ? (
            <Unresolved product={product} model={model} />
          ) : rechecking ? (
            <Recheck model={model} text="Reading your wallet on Base…" />
          ) : full ? (
            <>
              <p role="status">
                The open batch is full: it has taken its{" "}
                {limit != null ? `${usdc(limit)} USDC` : "limit"} of deposits.
                {closing && !closing.late ? " " + closing.text : ""} Your{" "}
                {usdc(held)} USDC waits in your wallet until the next one
                opens.
              </p>
              <div className={m.actions}>
                <button className={m.ghost} onClick={model.refresh} disabled={model.loading}>
                  {model.loading ? "Checking…" : "Check for a new batch"}
                </button>
              </div>
            </>
          ) : (
            <>
              {product.stage === "base" && (!fromArbitrum || typed || !!product.amountInput) && (
                <p className={m.alert} role="alert">
                  {error ||
                    "Your wallet on Base holds less USDC than this move needs. Add USDC or lower the amount."}
                </p>
              )}
              <div className={m.amount}>
                <label htmlFor={"amount-" + product.id}>Amount to deposit</label>
                <div className={m.amountBox}>
                  <input
                    id={"amount-" + product.id}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={exact(selected) || "0.00"}
                    value={product.amountInput ?? ""}
                    onChange={(event) => {
                      setTyped(true);
                      product.setAmountInput(event.target.value);
                    }}
                    disabled={acting}
                  />
                  <span>USDC</span>
                  <button
                    type="button"
                    onClick={() => {
                      setTyped(true);
                      product.setAmountInput(exact(room != null && cash != null && room < cash ? room : cash));
                    }}
                    disabled={acting || cash == null || cash === 0n}
                  >
                    Max
                  </button>
                </div>
                <p className={m.amountHint}>
                  {cash == null ? "Reading your Base wallet…" : `${usdc(cash)} USDC in your wallet on Base.`}
                  {minimum > 0n ? ` Minimum ${usdc(minimum)}.` : ""}
                  {room != null ? ` The open batch has room for ${usdc(room)}.` : ""}
                </p>
              </div>
              {overRoom ? (
                <p className={m.alert} role="alert">
                  That is more than the {usdc(room)} USDC the open batch can
                  still take.
                </p>
              ) : rest > 0n && room != null && selected >= room ? (
                <p className={m.note}>
                  The amount is set to what this batch can take. The other{" "}
                  {usdc(rest)} USDC stays in your wallet on Base; deposit it
                  into a later batch from this page.
                </p>
              ) : later > 0n && cash != null && selected >= cash ? (
                <p className={m.note}>
                  Deposit the available USDC now, or send more to Base.{" "}
                  {precise(later)} USDC of this move remains outside this deposit.
                </p>
              ) : rest > 0n ? (
                <p className={m.note}>
                  The other {usdc(rest)} USDC stays in your wallet for a later
                  batch.
                </p>
              ) : null}
              {additional > 0n && (
                <p className={m.note}>
                  {usdc(product.migrationCredit)} USDC from your move and{" "}
                  {usdc(additional)} USDC more from your wallet.
                </p>
              )}
              <ol className={m.pair}>
                <li data-state={product.stage === "approve" ? "current" : product.stage === "deposit" ? "done" : "next"}>
                  <span>Approve exactly {precise(selected)} USDC</span>
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
                      {acting ? "Check your wallet…" : `Deposit ${precise(selected)} USDC`}
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
              : "Deposits settle together when the batch closes: every one to two hours when valuations are on time. No time is promised."
          }
        >
          <p role="status">
            Your <strong>{usdc(queued)} USDC</strong> is in the vault’s open
            batch. It settles when the batch closes and starts earning then.
            {closing && !closing.late ? " " + closing.text : ""}
          </p>
          <p className={m.note}>
            Nothing to do in the meantime. You can close this page: come back
            after the batch closes to collect your shares.
          </p>
          {request?.cancellable && (
            <div className={m.actions}>
              <button
                className={m.ghost}
                disabled={batch.blocked}
                onClick={() => batch.submit("cancel", request.id)}
              >
                Cancel this deposit request
              </button>
              <span className={m.aside}>Returns the USDC to your wallet on Base</span>
            </div>
          )}
        </Step>

        <Step
          index={number("collect")}
          state={stateOf("collect")}
          title="Collect your shares"
          summary="One confirmation puts the vault’s shares in your wallet. Their value is your balance in Portfolio."
        >
          {product.stage === "recover" ? (
            <Unresolved product={product} model={model} />
          ) : (
            <>
              <p>
                The batch settled and your <strong>{usdc(queued)} USDC</strong>{" "}
                is earning. One confirmation puts the vault’s shares in your
                wallet; their value shows as your balance in Portfolio.
                {remaining > 0n || inVault > 0n ? " Then the next part of the move opens." : ""}
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
            </>
          )}
        </Step>
      </ol>

      {canStop &&
        (stopping ? (
          <div className={m.stop} role="group" aria-label="Stop the move">
            <p>
              Leave the remaining <strong>{precise(remaining)} USDC</strong>{" "}
              outside this move? This does not transfer or deposit any funds.
              You can resume from this page or deposit from Earn later.
            </p>
            <div className={m.actions}>
              <button
                className={m.ghost}
                onClick={() => {
                  keepRest(model.owner, product);
                  setStopping(false);
                }}
              >
                Keep the rest outside this move
              </button>
              <button className={m.textLink} onClick={() => setStopping(false)}>
                Go back
              </button>
            </div>
          </div>
        ) : (
          <p className={m.finish}>
            Not depositing the rest?{" "}
            <button className={m.textLink} onClick={() => setStopping(true)}>
              Keep the rest outside this move
            </button>
          </p>
        ))}
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

// A withdrawal made in another browser is not in this one's journal. Its hash
// brings the move here.
function Elsewhere({ model }) {
  const [vaultId, setVaultId] = useState(model.vaults?.[0]?.id || "arbitrum");
  const [hash, setHash] = useState("");
  return (
    <details className={`${m.help} ${m.elsewhere}`}>
      <summary>Started the move in another browser or on another device?</summary>
      <p>
        Progress is read from the chain, but the list of your withdrawals is
        kept in the browser where you made them. Paste the hash of your
        withdrawal from the previous vault (your wallet’s activity shows it) and
        the move continues here. If you already deposited that money from the
        other browser, it shows as waiting here too: choose to keep it in your
        wallet and the move closes.
      </p>
      <div className={m.hashRow}>
        <select
          aria-label="Previous vault"
          value={vaultId}
          onChange={(event) => setVaultId(event.target.value)}
          disabled={model.busy}
        >
          {(model.vaults || []).map((vault) => (
            <option key={vault.id} value={vault.id}>
              USDC on {vault.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Withdrawal transaction hash"
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          value={hash}
          onChange={(event) => {
            setHash(event.target.value);
            model.clearImportError?.();
          }}
          disabled={model.busy}
        />
        <button
          className={m.ghost}
          disabled={model.busy || !hash.trim()}
          onClick={async () => {
            if (await model.importWithdrawal(vaultId, hash)) setHash("");
          }}
        >
          Find it
        </button>
      </div>
      {model.importError && (
        <p className={m.alert} role="alert">
          {model.importError}
        </p>
      )}
    </details>
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

// What the holder is moving into, and beside it what they have now: what the
// new vault does, in a few lines. Its terms and limits are on its own page.
function Destination({ book, from, onOpen }) {
  const vault = book.vault;
  const hours = batchHours(vault);
  const every = hours ? `every ${hours.min} to ${hours.max} hours` : "every few hours";
  const networks = vault.networks.join(" and ");
  const rows = [
    ["Rate now", from ? pct(from.rateNow) : null, pct(vault.rateNow)],
    ["Lends on", from?.place, networks],
    ["Getting out", from ? "One transaction" : null, `In batches, ${every}`],
  ];
  return (
    <aside className={m.destination} aria-label="The previous vault and the new one">
      <span className={m.eyebrow}>{from ? "What changes if you move" : "Where your money goes"}</span>
      <h2>
        <TokenMark token="USDC" size={28} />
        {vault.title}
      </h2>
      <p>
        One deposit on Base, lent across networks. Thesauros develops this
        vault now: new lending markets and networks are being added to it.
      </p>
      {from ? (
        <table className={m.compare}>
          <thead>
            <tr>
              <th />
              <th>Previous vault</th>
              <th>New vault</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, before, after]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{before ?? "—"}</td>
                <td>{after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <dl>
          {rows.map(([label, , after]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{after}</dd>
            </div>
          ))}
        </dl>
      )}
      <ul className={m.gains}>
        <li>One deposit works on {networks} at once.</li>
        <li>Thesauros moves the money between lending markets as rates change.</li>
        <li>No fee is charged today.</li>
        <li>Every move is on chain and shown in Transparency.</li>
      </ul>
      {from && (
        <p className={m.destinationNote}>
          Your money keeps earning in the previous vault until you move it.
          When and how much is your choice.
        </p>
      )}
      <button className={m.textLink} onClick={() => onOpen("earn")}>
        Everything about the new vault
      </button>
    </aside>
  );
}

const QUESTIONS = [
  [
    "What happens to my money while it is still in the previous vault?",
    "It stays in that vault’s contract under your wallet, keeps earning there, and you can withdraw it at any time. Nothing moves until you confirm a transaction.",
  ],
  [
    "Do I have to move, and is there a deadline?",
    "No. The previous vaults keep working, pay interest and let you withdraw at any time; their contracts set no deadline. Thesauros develops only the new vault from here on, so new lending markets and networks are added there. The table on this page shows what you would give up and what you would get.",
  ],
  [
    "Why do I have to move it myself?",
    "Thesauros never holds your keys, so only you can take money out of one vault and put it into another. Each step is a transaction your wallet shows you before you confirm.",
  ],
  [
    "What if I close the page halfway?",
    "Nothing is lost: the money is where the last confirmed step left it. This browser remembers your withdrawals and picks up where you left off. In another browser or on another device, paste the withdrawal’s transaction hash on this page and it continues there.",
  ],
  [
    "Do I have to move everything at once?",
    "No, and with a large balance you should not. The vault takes a limited amount per batch, so take out what the next batch can take and leave the rest earning in the previous vault.",
  ],
];

export default function MoveApp({
  mode,
  user,
  book,
  migration,
  walletHere,
  kept,
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
  const active = products.filter((product) => product.stage !== "complete");
  const complete = products.filter((product) => product.stage === "complete");
  const [picked, setPicked] = useState(null);
  const shown =
    active.find((product) => product.id === picked) ||
    active.find((product) => product.recovery) ||
    active[0] ||
    null;
  // The first read of the previous vaults; later refreshes are silent.
  const reading = !!owner && walletHere && !migration.checked;
  // Positions the account sees while the wallet is not connected in this browser.
  const seen = book.account.previous.filter((vault) => MIGRATION_VAULT_IDS.includes(vault.id));
  const unread = book.account.previousUnread > 0 && !account.loading;
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
            ) : !walletHere ? (
              <section className={m.empty}>
                <h2>Connect the wallet that holds the position</h2>
                <p>
                  You are signed in as {short(owner)}, and that wallet is not
                  connected in this browser right now. The move is signed by
                  it, step by step.
                </p>
                {seen.length > 0 && (
                  <ul className={m.seen}>
                    {seen.map((vault) => (
                      <li key={vault.id}>
                        <NetworkMarks networks={[vault.place]} size={16} />
                        {vault.title}
                        <strong>
                          {money(vault.position.balance)} {vault.token}
                        </strong>
                      </li>
                    ))}
                  </ul>
                )}
                <ConnectAction className={m.primary} label="Connect wallet" />
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
                    batch={batch}
                  />
                )}
                {complete.map((product) => {
                  const journal = whole(product.left) ?? 0n;
                  const wallet = whole(product.cash);
                  // Slightly less on Base than was kept: the bridge's fee.
                  const left =
                    wallet != null && wallet > 0n && wallet < journal && (journal - wallet) * 50n <= journal
                      ? wallet
                      : journal;
                  const min = whole(product.minDeposit) ?? 0n;
                  const keptPart = left > 0n && left >= min && whole(kept?.[product.id]) != null;
                  return (
                    <section key={product.id} className={m.done} role="status">
                      <Mark state={keptPart ? "next" : "done"} index="·" />
                      <div>
                        <h2>
                          {keptPart ? `Move from ${product.name} stopped` : `Moved from ${product.name}`}
                        </h2>
                        <p>
                          {usdc(product.credited)} USDC from the previous vault
                          is in {book.vault.title}.
                          {left > 0n
                            ? keptPart
                              ? ` ${usdc(left)} USDC that you withdrew is in your wallet, by your choice, and is not deposited.`
                              : ` ${usdc(left, left < 10000n ? 6 : 2)} USDC of what you withdrew was not deposited: less than the vault’s minimum deposit.`
                            : ""}
                        </p>
                        {keptPart && (
                          <div className={m.actions}>
                            <button className={m.ghost} onClick={() => resumeMove(owner, product.id)}>
                              Resume: deposit the {usdc(left)} USDC
                            </button>
                          </div>
                        )}
                        <TxLinks rows={product.txs} />
                      </div>
                    </section>
                  );
                })}
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
                {unread && (
                  <p className={m.keptLine} role="status">
                    Some previous vaults could not be read right now, so a
                    position there may be missing from this page. Nothing is
                    assumed about it.
                  </p>
                )}
                {!reading && !unread && !active.length && !others.length && (
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
                {!reading && <Elsewhere model={migration} />}
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
          <Destination
            book={book}
            from={shown ? book.byId[shown.id] : seen[0] || null}
            onOpen={onOpen}
          />
        </div>
      </main>
    </div>
  );
}
