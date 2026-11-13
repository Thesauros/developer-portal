"use client";
import { useEffect, useRef, useState } from "react";
import s from "./guide.module.css";

import { vaultGuide as defaultSteps } from "./vault-guide";

const drawings = {
  app: (
    <>
      <rect x="5" y="2" width="14" height="20" rx="3" />
      <path d="M10 5h4M10 19h4M9 10h6m-6 4h4" />
    </>
  ),
  vault: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="4" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 8v2m0 4v2m-4-4h2m4 0h2" />
    </>
  ),
  market: (
    <>
      <path d="M4 20h16M6 15v-5m6 5V4m6 11V8" />
      <circle cx="6" cy="7" r=".6" />
      <circle cx="18" cy="5" r=".6" />
    </>
  ),
  activity: (
    <>
      <path d="M9 5h11M9 12h11M9 19h11" />
      <circle cx="4" cy="5" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="19" r="1" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="15" rx="4" />
      <path d="M5 6V5a2 2 0 0 1 2-2h10v3M21 11h-5a3 3 0 0 0 0 6h5" />
      <circle cx="16" cy="14" r=".7" />
    </>
  ),
  code: (
    <>
      <rect x="2" y="3" width="20" height="18" rx="4" />
      <path d="M9 7H8v4l-2 1 2 1v4h1m6-10h1v4l2 1-2 1v4h-1" />
    </>
  ),
};

function Icon({ name }) {
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
      {drawings[name]}
    </svg>
  );
}

export default function QuickGuide({
  steps = defaultSteps,
  open,
  onClose,
  navigate,
  returnFocusRef,
}) {
  const [step, setStep] = useState(0);
  const dialog = useRef(null);
  const title = useRef(null);
  const opener = useRef(null);
  const restoreFocus = useRef(true);
  const content = useRef(null);
  const current = steps[step];

  useEffect(() => {
    if (!open) return;
    const activeElement = returnFocusRef?.current || document.activeElement;
    if (
      activeElement !== document.body &&
      !dialog.current?.contains(activeElement)
    )
      opener.current = activeElement;
    restoreFocus.current = true;
    setStep(0);
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!element.open) element.showModal();
    const focusFrame = requestAnimationFrame(() => title.current?.focus());
    return () => {
      cancelAnimationFrame(focusFrame);
      if (element.open) element.close();
      document.body.style.overflow = previousOverflow;
      const returnTarget = opener.current;
      if (restoreFocus.current && returnTarget?.isConnected)
        requestAnimationFrame(() => {
          if (returnTarget.isConnected && !element.open)
            returnTarget.focus({ preventScroll: true });
        });
    };
  }, [open]);

  function goToStep(index) {
    setStep(index);
    requestAnimationFrame(() => {
      content.current?.scrollTo({ top: 0 });
      title.current?.focus({ preventScroll: true });
    });
  }

  function dismiss() {
    dialog.current?.close();
    onClose();
  }

  function visit(destination) {
    restoreFocus.current = false;
    dismiss();
    requestAnimationFrame(() => navigate(destination));
  }

  function closeOnBackdrop(event) {
    if (event.target !== dialog.current) return;
    const bounds = dialog.current.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      dismiss();
  }

  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-labelledby="quick-guide-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={closeOnBackdrop}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...dialog.current.querySelectorAll(
            "button:not([disabled]), a[href], [tabindex='0']",
          ),
        ].filter((node) => node.getClientRects().length);
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className={s.frame}>
        <header className={s.header}>
          <div className={s.brand}>
            <img src="/brand/mark.svg" width="25" height="25" alt="" />
            <span id="quick-guide-title">A quick introduction</span>
          </div>
          <button
            className={s.close}
            onClick={dismiss}
            aria-label="Close quick guide"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <nav className={s.progress} aria-label="Guide steps">
          {steps.map((item, index) => (
            <button
              key={item.short}
              onClick={() => goToStep(index)}
              aria-current={step === index ? "step" : undefined}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {item.short}
            </button>
          ))}
        </nav>
        <div ref={content} className={s.content}>
          <div className={s.visual} aria-hidden="true">
            <span className={s.visualLabel}>How it works</span>
            <div className={s.diagram}>
              {current.visual.map(([icon, label, detail], index) => (
                <div
                  className={`${s.diagramCard} ${index === 1 ? s.diagramMain : ""}`}
                  key={label}
                >
                  <span className={s.icon}>
                    <Icon name={icon} />
                  </span>
                  <div>
                    <strong>{label}</strong>
                    <span>{detail}</span>
                  </div>
                </div>
              ))}
            </div>
            <p>{current.note}</p>
          </div>
          <section className={s.copy} aria-labelledby="quick-guide-step-title">
            <span className={s.eyebrow}>
              Step {step + 1} of {steps.length}
            </span>
            <h2 ref={title} tabIndex={-1} id="quick-guide-step-title">
              {current.title}
            </h2>
            <p>{current.body}</p>
            <p className={s.detail}>{current.detail}</p>
            {current.action && (
              <button
                className={s.contextAction}
                onClick={() => visit(current.destination)}
              >
                {current.action}
              </button>
            )}
            {step === steps.length - 1 && (
              <div className={s.finalActions}>
                <button className={s.primary} onClick={() => visit("earn")}>
                  Open Earn
                </button>
                <button className={s.docsLink} onClick={() => visit("developers")}>
                  Bring Earn into your app
                </button>
              </div>
            )}
          </section>
        </div>
        <footer className={s.footer}>
          <button className={s.skip} onClick={dismiss}>
            {step === steps.length - 1 ? "Close guide" : "Skip for now"}
          </button>
          <div>
            {step > 0 && (
              <button className={s.back} onClick={() => goToStep(step - 1)}>
                Back
              </button>
            )}
            {step < steps.length - 1 ? (
              <button className={s.primary} onClick={() => goToStep(step + 1)}>
                Next
              </button>
            ) : (
              <button className={s.back} onClick={() => goToStep(0)}>
                Start again
              </button>
            )}
          </div>
        </footer>
      </div>
    </dialog>
  );
}
