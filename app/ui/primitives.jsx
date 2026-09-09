'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import s from '../platform.module.css';
import { IconCheck, IconCopy, IconX } from '../lib/icons';

/* ---------- copy ---------- */

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const copy = useCallback((text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, []);
  useEffect(() => () => timer.current && clearTimeout(timer.current), []);
  return { copied, copy };
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    /* noop */
  }
  document.body.removeChild(ta);
}

export function CopyButton({ text, label = 'Copy', className = '' }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      className={`${s.copyBtn} ${copied ? s.copyBtnDone : ''} ${className}`}
      onClick={() => copy(text)}
      aria-label={label}
    >
      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

/* ---------- syntax highlighting (lightweight, dependency-free) ---------- */

const TOKEN_RE =
  /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b(?:import|from|export|const|let|var|new|await|async|return|function|class|if|else|for|while|try|except|catch|finally|def|with|as|pass|raise|not|in|is|None|True|False|null|undefined|true|false|this|print)\b)|(\b\d[\d_]*(?:\.\d+)?\b)|(#.*$|\/\/.*$)|([A-Za-z_$][\w$]*)(?=\s*\()|(\{|\}|\(|\)|\[|\]|=>|==|!=|<=|>=|&&|\|\||[.,;:=+\-*/<>!&|])/gm;

const TOKEN_CLASS = {
  str: '#7ee0a0',
  kw: '#6ea8ff',
  num: '#f0b072',
  com: '#91a5bd',
  fn: '#9ecbff',
  punc: '#8fa3c4',
  plain: '#c3cee2',
};

function highlightLine(line) {
  const out = [];
  let last = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    if (m.index > last) {
      out.push({ c: TOKEN_CLASS.plain, t: line.slice(last, m.index) });
    }
    const [full, str, kw, num, com, fn, punc] = m;
    const color = str
      ? TOKEN_CLASS.str
      : kw
        ? TOKEN_CLASS.kw
        : num
          ? TOKEN_CLASS.num
          : com
            ? TOKEN_CLASS.com
            : fn
              ? TOKEN_CLASS.fn
              : punc
                ? TOKEN_CLASS.punc
                : TOKEN_CLASS.plain;
    out.push({ c: color, t: full });
    last = m.index + full.length;
    if (full.length === 0) TOKEN_RE.lastIndex++;
  }
  if (last < line.length) out.push({ c: TOKEN_CLASS.plain, t: line.slice(last) });
  if (out.length === 0) out.push({ c: TOKEN_CLASS.plain, t: ' ' });
  return out;
}

export function CodeBlock({ code, file, lang, showLines = true, className = '' }) {
  const lines = code.replace(/\n$/, '').split('\n');
  const raw = code;
  return (
    <div className={`${s.codeWin} ${className}`}>
      <div className={s.codeHead}>
        <span className={s.codeDots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {file ? <span className={s.codeFile}>{file}</span> : null}
        {lang ? <span className={s.codeLang}>{lang}</span> : null}
        <CopyButton text={raw} className="" />
      </div>
      <div className={s.codeBody}>
        <pre>
          <code>
            {lines.map((line, i) => (
              <span className={s.codeLine} key={i}>
                {showLines ? (
                  <span className={s.ln}>{String(i + 1).padStart(2, ' ')}</span>
                ) : null}
                {highlightLine(line).map((p, j) => (
                  <span key={j} style={{ color: p.c }}>
                    {p.t}
                  </span>
                ))}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

/* ---------- badges ---------- */

const BADGE_TONES = {
  teal: s.bTeal,
  green: s.bGreen,
  blue: s.bBlue,
  orange: s.bOrange,
  purple: s.bPurple,
  red: s.bRed,
  gray: s.bGray,
};

export function Badge({ tone = 'gray', dot = false, children, className = '' }) {
  return (
    <span className={`${s.badge} ${BADGE_TONES[tone] || s.bGray} ${className}`}>
      {dot ? <i aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function MethodBadge({ method }) {
  const cls =
    method === 'GET' ? s.mGet : method === 'POST' ? s.mPost : method === 'DELETE' ? s.mDelete : s.mGet;
  return <span className={`${s.method} ${cls}`}>{method}</span>;
}

/* ---------- modal ---------- */

export function Modal({ open, onClose, title, children }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector('input, select, textarea, button')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const controls = [...(dialogRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]') || [])].filter(node => node.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) return;
        if (e.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={dialogRef}
      className={s.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={s.modal}>
        <div className={s.modalHead}>
          <h3 className={s.h2}>{title}</h3>
          <button type="button" className={s.btnGhost} onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>
        <div className={s.modalBody}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- misc ---------- */

export function Empty({ children }) {
  return <div className={s.empty}>{children}</div>;
}

export function Spinner() {
  return <span className={s.spinner} aria-label="Loading" />;
}
