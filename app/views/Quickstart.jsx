'use client';

import { useState } from 'react';
import s from '../platform.module.css';
import { CodeBlock, Badge, CopyButton } from '../ui/primitives';
import { DEFAULT_KEY, IS_REAL, ACCOUNT_APP_URL } from '../lib/api';
import {
  QUICKSTART_INSTALL,
  QUICKSTART_INIT,
  QUICKSTART_DEPOSIT,
  QUICKSTART_MONITOR,
} from '../data/code';
import { IconArrowRight, IconCheck, IconKey } from '../lib/icons';

const LANGS = [
  { id: 'ts', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'curl', label: 'cURL' },
];

function LangTabs({ lang, setLang }) {
  return (
    <div className={s.codeTabs} role="tablist" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          role="tab"
          aria-selected={lang === l.id}
          className={`${s.codeTab} ${lang === l.id ? s.codeTabActive : ''}`}
          onClick={() => setLang(l.id)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

function Step({ n, title, desc, children, delay }) {
  return (
    <div className={s.revealItem} style={{ animationDelay: `${delay}ms`, display: 'grid', gridTemplateColumns: '52px 1fr', gap: 18 }}>
      <div>
        <div
          className={s.mono}
          style={{
            width: 40,
            height: 40,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 10,
            border: '1px solid rgba(91,149,255,0.35)',
            background: 'var(--blue-dim)',
            color: 'var(--blue-strong)',
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          {n}
        </div>
      </div>
      <div style={{ minWidth: 0, paddingBottom: 34 }}>
        <h3 className={s.h2} style={{ fontSize: 18 }}>{title}</h3>
        <p className={s.faint} style={{ marginTop: 6, marginBottom: 16, fontSize: 13.5, lineHeight: 1.6, maxWidth: 620 }}>
          {desc}
        </p>
        {children}
      </div>
    </div>
  );
}

export default function Quickstart({ go }) {
  const [lang, setLang] = useState('ts');

  return (
    <div className={s.view}>
      <span className={s.kicker}>Quickstart</span>
      <h1 className={s.viewTitle}>First yield position in 5 minutes</h1>
      <p className={s.viewLead}>
        Everything below runs against the live sandbox — no account, no contract deployment. The
        requests you see are the exact ones the SDK makes for you.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '22px 0 30px' }}>
        <LangTabs lang={lang} setLang={setLang} />
        <span className={s.faint} style={{ fontSize: 12.5 }}>
          {IS_REAL ? (
            <>
              These samples run against the built-in sandbox.{' '}
              <a
                href={ACCOUNT_APP_URL}
                target="_blank"
                rel="noreferrer noopener"
                className={s.btnGhost}
                style={{ minHeight: 'auto', padding: '0 4px', color: 'var(--blue-strong)' }}
              >
                Create your live key →
              </a>
            </>
          ) : (
            <>
              Sandbox key is pre-filled.{' '}
              <button type="button" className={s.btnGhost} style={{ minHeight: 'auto', padding: '0 4px', color: 'var(--blue-strong)' }} onClick={() => go('keys')}>
                Create your own →
              </button>
            </>
          )}
        </span>
      </div>

      {/* sandbox key callout */}
      <div
        className={`${s.card} ${s.cardPad} ${s.revealItem}`}
        style={{ display: 'flex', alignItems: 'center', gap: 14, borderLeft: '3px solid var(--teal)', marginBottom: 34 }}
      >
        <IconKey size={18} style={{ color: 'var(--teal)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={s.h3} style={{ fontSize: 13.5 }}>
            {IS_REAL ? 'Default portal key' : 'Shared sandbox key'}
          </div>
          <div className={`${s.mono} ${s.faint}`} style={{ fontSize: 12, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {DEFAULT_KEY || 'No credential ships with the portal — Partner API calls are authenticated server-side.'}
          </div>
        </div>
        {DEFAULT_KEY ? <CopyButton text={DEFAULT_KEY} label="Copy key" /> : null}
        <Badge tone="teal">test mode</Badge>
      </div>

      {IS_REAL ? (
        <div
          className={`${s.card} ${s.cardPad} ${s.revealItem}`}
          style={{ display: 'flex', alignItems: 'flex-start', gap: 14, borderLeft: '3px solid var(--orange)', marginBottom: 34 }}
        >
          <IconKey size={18} style={{ color: 'var(--orange)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={s.h3} style={{ fontSize: 13.5 }}>Getting a live key</div>
            <p className={s.faint} style={{ fontSize: 12.5, lineHeight: 1.65, marginTop: 5 }}>
              Everything on this page runs against the built-in sandbox with the test key above.
              Production is a different credential: a <code className={s.mono}>tsk_live_</code> key,
              bound to your account, and the production Partner API rejects every{' '}
              <code className={s.mono}>tsk_test_</code> key.
            </p>
            <p className={s.faint} style={{ fontSize: 12.5, lineHeight: 1.65, marginTop: 8 }}>
              Live keys are created in the <span className={s.strong}>account app</span>, not here —
              this portal has no sign-in, so it cannot tell one partner from another and never mints
              them. Sign up, open <span className={s.strong}>Developer tools → API keys</span>, and
              create your first live key; it is shown exactly once. Then use it in your own backend,
              or paste it into <button type="button" className={s.btnGhost} style={{ minHeight: 'auto', padding: '0 4px', color: 'var(--blue-strong)' }} onClick={() => go('keys')}>API Keys</button>{' '}
              as the session key to drive these views against production data. No approval step, no
              sales call.
            </p>
            <div className={s.row} style={{ marginTop: 12 }}>
              <a
                className={`${s.btn} ${s.btnPrimary} ${s.btnSm}`}
                href={ACCOUNT_APP_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open the account app <IconArrowRight size={13} />
              </a>
              <span className={s.faint} style={{ fontSize: 12 }}>
                Published terms: 25% performance fee on yield, nothing on principal. Partners keep 50%
                of that fee as standard, up to 80%.
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <Step
        n="1"
        title="Install the SDK"
        desc="Typed clients for TypeScript and Python, or hit the REST API directly. Zero runtime dependencies."
        delay={40}
      >
        <CodeBlock {...QUICKSTART_INSTALL[lang]} />
      </Step>

      <Step
        n="2"
        title="Initialize the client"
        desc={
          IS_REAL
            ? 'Authenticate with your API key. These samples run against the sandbox, where tsk_test_ and tsk_live_ keys are both accepted and drive the same deterministic simulation — no real funds move. Production is stricter: only tsk_live_ keys authenticate there, and you create yours in the account app above.'
            : 'Authenticate with your API key. Test keys (tsk_test_) and live keys (tsk_live_) are both accepted; live keys carry a higher rate ceiling. In this sandbox both run the same deterministic simulation — no real funds move.'
        }
        delay={90}
      >
        <CodeBlock {...QUICKSTART_INIT[lang]} />
      </Step>

      <Step
        n="3"
        title="Open a yield position"
        desc="One call deposits from your user's wallet into the optimal venue. Non-custodial — the user signs, you never hold funds."
        delay={140}
      >
        <CodeBlock {...QUICKSTART_DEPOSIT[lang]} />
      </Step>

      <Step
        n="4"
        title="Monitor and rebalance"
        desc="Value accrues continuously. The router rebalances automatically and you can observe every decision."
        delay={190}
      >
        <CodeBlock {...QUICKSTART_MONITOR[lang]} />
      </Step>

      <div
        className={`${s.card} ${s.cardPad} ${s.revealItem}`}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, background: 'linear-gradient(120deg, rgba(58,127,255,0.10), rgba(77,234,216,0.06))' }}
      >
        <div>
          <div className={s.h3}>Ready for the full surface?</div>
          <div className={s.faint} style={{ fontSize: 13, marginTop: 4 }}>
            Explore every endpoint with live Try-it, or wire up signed webhooks.
          </div>
        </div>
        <div className={s.row}>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => go('reference')}>
            API Reference <IconArrowRight size={14} />
          </button>
          <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => go('webhooks')}>
            Webhooks
          </button>
        </div>
      </div>
    </div>
  );
}
