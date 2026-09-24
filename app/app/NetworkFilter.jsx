"use client";
import { useEffect, useRef } from "react";
import { toggleNetwork } from "../../lib/workspace-view.mjs";
import s from "./workspace.module.css";
export default function NetworkFilter({ options, value, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (event) => {
      if (!ref.current?.open) return;
      if (event.type === "keydown" && event.key === "Escape") {
        ref.current.open = false;
        ref.current.querySelector("summary").focus();
      } else if (
        event.type === "pointerdown" &&
        !ref.current.contains(event.target)
      )
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  const label =
    value === null
      ? "All networks"
      : value.length === 1
        ? value[0]
        : `${value.length} networks`;
  return (
    <details className={s.networkFilter} ref={ref}>
      <summary aria-label={`Filter networks: ${label}`}>
        {label}
        <svg
          className={s.filterGlyph}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 6h14M6 10h8M8 14h4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </summary>
      <div className={s.networkMenu}>
        <div className={s.filterActions}>
          <button onClick={() => onChange(null)}>Select all</button>
          <button onClick={() => onChange([])}>Clear</button>
        </div>
        <fieldset>
          <legend>Networks to display</legend>
          {options.map((name) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={value === null || value.includes(name)}
                onChange={() => onChange(toggleNetwork(value, name, options))}
              />
              {name}
            </label>
          ))}
        </fieldset>
        {!options.length && <p>Network data is loading.</p>}
      </div>
    </details>
  );
}
