"use client";
import { useEffect, useState } from "react";

// When a move is over. The journal of a move counts it finished only when every
// dollar withdrawn from the previous vault has been deposited into the new one.
// Real moves end short of that: a bridge keeps a fee, or the holder keeps some
// of the money. So a move is also finished when what is left is too small to
// deposit, or when the holder says the rest stays in their wallet. This changes
// what the app shows and asks for, never an amount: every figure still comes
// from the chain.
const KEY = (owner) => "thesauros.move.finished.v1." + owner.toLowerCase();
const EVENT = "thesauros:move-finished";
const units = (value) => (/^\d+$/.test(String(value ?? "")) ? BigInt(value) : 0n);

function read(owner) {
  try {
    const value = JSON.parse(localStorage.getItem(KEY(owner)) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

// The holder keeps the rest. Tied to the amount withdrawn so far: a later
// withdrawal from the same vault opens the move again.
export function finishMove(owner, product) {
  try {
    const value = read(owner);
    value[product.id] = String(product.withdrawn);
    localStorage.setItem(KEY(owner), JSON.stringify(value));
  } catch {
    /* Without storage the move simply stays open. */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useFinished(owner) {
  const [value, setValue] = useState({});
  useEffect(() => {
    if (!owner) {
      setValue({});
      return undefined;
    }
    const sync = () => setValue(read(owner));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [owner]);
  return value;
}

// Nothing left in the previous vault, nothing queued or unconfirmed, and what
// was withdrawn is either deposited, too small to deposit, or kept on purpose.
export function isFinished(product, finished = {}) {
  if (product.stage === "complete") return true;
  if (!["base", "approve", "deposit"].includes(product.stage)) return false;
  if (product.positionStatus !== "ready" || units(product.shares) > 0n) return false;
  const remaining = units(product.amount);
  const minimum = units(product.minDeposit);
  if (remaining > 0n && remaining < minimum) return true;
  return finished[product.id] === String(product.withdrawn);
}
