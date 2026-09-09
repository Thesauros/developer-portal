"use client";
import { useEffect, useState } from "react";
import "./brand-loading.css";

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

// Reveal only after a noticeable wait. Data can render as soon as it arrives;
// the non-blocking overlay dissolves over it without a minimum loading time.
export default function BrandLoading({
  pending = true,
  fullscreen = false,
  label = "Opening your workspace",
  children,
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!pending) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), 360);
    return () => clearTimeout(timer);
  }, [pending]);
  return (
    <div
      className="brand-pending"
      data-pending={pending}
      data-fullscreen={fullscreen || undefined}
      aria-busy={pending}
    >
      {children != null && (
        <div
          className="brand-pending-content"
          inert={pending}
          aria-hidden={pending}
        >
          {children}
        </div>
      )}
      <div
        className="brand-loading"
        data-visible={visible}
        role={visible ? "status" : undefined}
        aria-hidden={!visible}
      >
        <div className="brand-loading-inner">
          <div className="brand-loading-symbol" aria-hidden="true">
            <img src={base + "/brand/mark.svg"} width="46" height="44" alt="" />
          </div>
          <span className="brand-loading-name" aria-hidden="true">
            Thesauros
          </span>
          <span className="brand-loading-label">{label}</span>
        </div>
      </div>
    </div>
  );
}
