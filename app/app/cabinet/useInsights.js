"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Market data is public and the same for everyone, so a period already read
// answers instantly and refreshes behind the scenes. Account data is never kept.
const remembered = new Map();
const PERIODS = ["7d", "30d", "180d"];
const marketQuery = (period) => "period=" + (period || "30d");
async function read(query) {
  const response = await fetch("/app/insights?" + query, {
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load data.");
  return body;
}
let warming = null;
function warmPeriods() {
  warming ??= (async () => {
    for (const period of PERIODS) {
      const query = marketQuery(period);
      if (remembered.has(query)) continue;
      try {
        remembered.set(query, await read(query));
      } catch {
        /* A later switch reads it again and reports any failure. */
      }
    }
  })();
}

// Fetches /app/insights. `kind` is "market" (vault performance, allocation) or
// "account" (the signed-in wallet's earnings and history).
export default function useInsights(kind, param = "", enabled = true) {
  const [state, setState] = useState({
    data: null,
    loading: enabled,
    error: "",
  });
  const sequence = useRef(0);
  const load = useCallback(
    async (fresh = false) => {
      const id = ++sequence.current;
      const query =
        kind === "account"
          ? "kind=account" + (fresh === true ? "&fresh=1" : "")
          : marketQuery(param);
      const known = kind === "market" ? remembered.get(query) : null;
      setState((s) => ({
        ...s,
        data: known || s.data,
        loading: true,
        error: "",
      }));
      try {
        const body = await read(query);
        if (kind === "market") remembered.set(query, body);
        if (id === sequence.current)
          setState({ data: body, loading: false, error: "" });
        if (kind === "market") warmPeriods();
      } catch (error) {
        if (id === sequence.current)
          setState((s) => ({
            ...s,
            loading: false,
            error: error.message || "Could not load data.",
          }));
      }
    },
    [kind, param],
  );
  useEffect(() => {
    if (!enabled) return;
    load();
    const timer = setInterval(load, 120000);
    return () => clearInterval(timer);
  }, [enabled, load]);
  return { ...state, refresh: load };
}
