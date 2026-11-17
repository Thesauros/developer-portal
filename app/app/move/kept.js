"use client";
import { useEffect, useState } from "react";

// What a holder decided to keep in their wallet instead of depositing, per
// previous vault, in token units. A move ends when everything withdrawn is
// deposited; real moves end short of that, because the holder keeps some of the
// money. Recording that choice lets the move finish, or the next part begin.
// It changes what the app asks for, never an amount: every figure still comes
// from the chain, and money still in a previous vault or in a request is never
// hidden by it (see deriveMigration).
const KEY = (owner) => "thesauros.move.kept.v1." + owner.toLowerCase();
const EVENT = "thesauros:move-kept";
const units = (value) => (/^\d+$/.test(String(value ?? "")) ? BigInt(value) : 0n);

function read(owner) {
  try {
    const value = JSON.parse(localStorage.getItem(KEY(owner)) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
function write(owner, value) {
  try {
    localStorage.setItem(KEY(owner), JSON.stringify(value));
  } catch {
    /* Without storage the move simply stays open. */
  }
  window.dispatchEvent(new Event(EVENT));
}

// Keep what is still waiting to be deposited: added to what was kept before.
export function keepRest(owner, product) {
  const value = read(owner);
  value[product.id] = (units(value[product.id]) + units(product.amount)).toString();
  write(owner, value);
}
// Change of mind: what was kept is asked for again.
export function resumeMove(owner, id) {
  const value = read(owner);
  delete value[id];
  write(owner, value);
}

export function useKept(owner) {
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
