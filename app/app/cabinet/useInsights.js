"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Fetches /app/insights. `kind` is "market" (vault performance, allocation) or
// "account" (the signed-in wallet's earnings and history).
export default function useInsights(kind, param = "", enabled = true) {
  const [state, setState] = useState({
    data: null,
    loading: enabled,
    error: "",
  });
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const id = ++sequence.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const query =
        kind === "account" ? "kind=account" : "period=" + (param || "30d");
      const response = await fetch("/app/insights?" + query, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load data.");
      if (id === sequence.current)
        setState({ data: body, loading: false, error: "" });
    } catch (error) {
      if (id === sequence.current)
        setState((s) => ({
          ...s,
          loading: false,
          error: error.message || "Could not load data.",
        }));
    }
  }, [kind, param]);
  useEffect(() => {
    if (!enabled) return;
    load();
    const timer = setInterval(load, 120000);
    return () => clearInterval(timer);
  }, [enabled, load]);
  return { ...state, refresh: load };
}
