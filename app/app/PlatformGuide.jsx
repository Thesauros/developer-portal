"use client";

import { useEffect, useId, useRef } from "react";
import s from "./platform-guide.module.css";

const destinations = [
  {
    title: "Explore performance",
    description: "See vault results, allocation and capital movements.",
    destination: "performance",
  },
  {
    title: "Try Earn",
    description: "Experience deposits and withdrawals with your wallet.",
    destination: "earn",
  },
  {
    title: "Start integrating",
    description: "Find integration paths, SDKs and API documentation.",
    destination: "developers",
  },
];

function ProductIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="2" width="16" height="20" rx="3" />
      <path d="M9 5h6M8 10h8M8 14h5M10 19h4" />
    </svg>
  );
}

function ProvidersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="12" width="4" height="8" rx="1" />
      <rect x="10" y="5" width="4" height="15" rx="1" />
      <rect x="17" y="9" width="4" height="11" rx="1" />
    </svg>
  );
}

export default function PlatformGuide({ onClose, navigate, returnFocusRef }) {
  const dialog = useRef(null);
  const title = useRef(null);
  const opener = useRef(null);
  const restoreFocus = useRef(true);
  const id = useId();
  const titleId = id + "-title";
  const descriptionId = id + "-description";

  useEffect(() => {
    const element = dialog.current;
    const initialFocus = returnFocusRef?.current || document.activeElement;
    if (initialFocus !== document.body && !element.contains(initialFocus))
      opener.current = initialFocus;
    restoreFocus.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!element.open) element.showModal();
    const focusFrame = requestAnimationFrame(() =>
      title.current?.focus({ preventScroll: true }),
    );
    return () => {
      cancelAnimationFrame(focusFrame);
      if (element.open) element.close();
      document.body.style.overflow = previousOverflow;
      if (restoreFocus.current) {
        requestAnimationFrame(() => {
          if (document.querySelector("dialog[open]")) return;
          const returnTarget =
            opener.current?.isConnected && !opener.current.closest("[inert]")
              ? opener.current
              : document.querySelector("#account-main h1");
          returnTarget?.focus({ preventScroll: true });
        });
      }
    };
  }, [returnFocusRef]);

  function dismiss() {
    dialog.current?.close();
    onClose();
  }

  function visit(destination) {
    restoreFocus.current = false;
    dismiss();
    requestAnimationFrame(() => navigate(destination));
  }

  function trapFocus(event) {
    if (event.key !== "Tab") return;
    const element = dialog.current;
    const controls = [
      ...element.querySelectorAll(
        "button:not([disabled]), a[href], [tabindex='0']",
      ),
    ].filter((node) => node.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    const active = document.activeElement;
    if (active === title.current || !element.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={trapFocus}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target !== dialog.current) return;
        const bounds = dialog.current.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          dismiss();
      }}
    >
      <div className={s.frame}>
        <header className={s.header}>
          <div className={s.brand}>
            <img src="/brand/mark.svg" width="24" height="24" alt="" />
            <span>Thesauros</span>
          </div>
          <button
            className={s.close}
            type="button"
            aria-label="Close platform guide"
            onClick={dismiss}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className={s.content}>
          <span className={s.eyebrow}>A quick introduction</span>
          <h2 ref={title} id={titleId} tabIndex={-1} className={s.title}>
            Earn belongs in your product.
          </h2>
          <p id={descriptionId} className={s.description}>
            Thesauros connects your financial app to onchain lending. Your
            customers keep your interface; vaults allocate deposited capital
            across lending providers. Use this workspace to inspect performance
            and capital movements, try the Earn experience, and find your
            integration path.
          </p>

          <ol
            className={s.relationship}
            aria-label="How Thesauros fits your product"
          >
            <li>
              <span className={s.nodeIcon}>
                <ProductIcon />
              </span>
              <div>
                <strong>Your product</strong>
                <span>Interface & customers</span>
              </div>
            </li>
            <li>
              <span className={`${s.nodeIcon} ${s.thesaurosIcon}`}>
                <img src="/brand/mark.svg" width="23" height="23" alt="" />
              </span>
              <div>
                <strong>Thesauros vaults</strong>
                <span>Allocation & accounting</span>
              </div>
            </li>
            <li>
              <span className={s.nodeIcon}>
                <ProvidersIcon />
              </span>
              <div>
                <strong>Lending providers</strong>
                <span>Underlying markets</span>
              </div>
            </li>
          </ol>

          <div className={s.destinations} aria-label="Choose where to start">
            {destinations.map((item) => (
              <button
                key={item.destination}
                className={s.destination}
                type="button"
                onClick={() => visit(item.destination)}
              >
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </button>
            ))}
          </div>
        </div>
        <footer className={s.footer}>
          <p>You can reopen this guide anytime.</p>
          <button className={s.explore} type="button" onClick={dismiss}>
            Explore workspace
          </button>
        </footer>
      </div>
    </dialog>
  );
}
