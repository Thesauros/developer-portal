'use client';

import { useCallback, useEffect, useState } from 'react';
import s from '../platform.module.css';
import { get, post, del, maskKey, timeAgo, DEFAULT_KEY, IS_REAL, ADMIN_BASE, ACCOUNT_APP_URL } from '../lib/api';
import { Badge, Modal, CopyButton, Empty, Spinner } from '../ui/primitives';
import { IconKey, IconPlus, IconTrash, IconShield } from '../lib/icons';

export default function ApiKeys({ apiKey, setApiKey }) {
  const [keys, setKeys] = useState(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [env, setEnv] = useState('test');
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState(null); // shown once after create
  const [error, setError] = useState(null);

  // Real mode manages keys against the production Partner API. Key management
  // needs keys:admin, so it goes through the server-side admin proxy
  // (/api/admin/*), which attaches PARTNER_ADMIN_KEY on the server — the admin
  // credential is never shipped to the browser. Sandbox mode calls the built-in
  // API with the portal session key.
  const API_BASE = IS_REAL ? ADMIN_BASE : undefined;
  const adminKey = IS_REAL ? null : apiKey;

  const load = useCallback(() => {
    setLoading(true);
    get('/keys', { key: adminKey, base: API_BASE })
      .then(({ data }) => setKeys(Array.isArray(data) ? data : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [adminKey, API_BASE]);

  useEffect(() => {
    load();
  }, [load]);

  async function createKey(e) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      // Real mode offers no live option (see the modal): the portal never mints
      // live keys, so the environment is pinned to test there regardless of state.
      const environment = IS_REAL ? 'test' : env;
      const { data } = await post(
        '/keys',
        { label: label || 'Untitled key', environment },
        { key: adminKey, base: API_BASE },
      );
      setNewSecret(data);
      setLabel('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id) {
    setError(null);
    try {
      await del(`/keys/${id}`, { key: adminKey, base: API_BASE });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className={s.view}>
      <div className={s.row} style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span className={s.kicker}>Credentials</span>
          <h1 className={s.viewTitle}>API Keys</h1>
          <p className={s.viewLead}>
            {IS_REAL ? (
              <>
                Keys authenticate every request. Secrets are shown exactly once — store them in a
                secret manager. This view manages keys server-side through the portal’s admin proxy
                (keys:admin). It does not mint live keys: your own{' '}
                <code className={s.mono}>tsk_live_</code> key is created in the account app, then
                used here.
              </>
            ) : (
              <>
                Keys authenticate every request. Test keys hit the sandbox; live keys route production
                flow. Secrets are shown exactly once — store them in a secret manager.
              </>
            )}
          </p>
        </div>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => { setNewSecret(null); setCreateOpen(true); }}>
          <IconPlus size={14} /> Create key
        </button>
      </div>

      {IS_REAL ? (
        <div
          className={`${s.card} ${s.cardPad} ${s.revealItem}`}
          style={{ marginTop: 22, display: 'flex', gap: 14, alignItems: 'flex-start', borderLeft: '3px solid var(--orange)' }}
        >
          <IconKey size={18} style={{ color: 'var(--orange)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div className={s.h3} style={{ fontSize: 13.5 }}>Live keys are created in the account app</div>
            <p className={s.faint} style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 4 }}>
              A production <code className={s.mono}>tsk_live_</code> key is bound to your account, so
              it is issued where your identity lives — not from this portal, which has no sign-in and
              cannot tell one partner from another. Sign in to the account app, open{' '}
              <span className={s.strong}>Developer tools → API keys</span>, and create your first live
              key there; it is shown once. Then paste it below as the portal session key to drive the
              views on this site.
            </p>
            <a
              className={`${s.btn} ${s.btnSecondary} ${s.btnSm}`}
              style={{ marginTop: 10, display: 'inline-flex' }}
              href={ACCOUNT_APP_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open the account app
            </a>
          </div>
        </div>
      ) : null}

      {/* active key selector */}
      <div className={`${s.card} ${s.cardPad} ${s.revealItem}`} style={{ marginTop: 26, borderLeft: '3px solid var(--blue)' }}>
        <div className={s.row} style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className={s.h3} style={{ fontSize: 13.5 }}>Portal session key</div>
            <div className={s.faint} style={{ fontSize: 12.5, marginTop: 3 }}>
              {IS_REAL
                ? 'Partner API calls are authenticated server-side by the portal, so no credential is pre-filled here. A key you create below becomes the session key via “Use as portal key”.'
                : 'This key is used by the Try-it playground and dashboard calls on this page.'}
            </div>
          </div>
          <div className={s.row}>
            <code className={`${s.mono}`} style={{ fontSize: 12, color: 'var(--ink)' }}>{maskKey(apiKey)}</code>
            <CopyButton text={apiKey} label="Copy" />
            {apiKey !== DEFAULT_KEY ? (
              <button type="button" className={`${s.btn} ${s.btnGhost} ${s.btnSm}`} onClick={() => setApiKey(DEFAULT_KEY)}>
                {IS_REAL ? 'Reset to default' : 'Reset to sandbox'}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className={`${s.card} ${s.cardPad}`} style={{ marginTop: 16, color: 'var(--red)', fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      <div className={`${s.card} ${s.revealItem}`} style={{ marginTop: 22, overflow: 'hidden' }}>
        <div className={s.panelHead}>
          <span className={s.h3}>All keys</span>
          <Badge tone="gray">{keys ? keys.length : 0} total</Badge>
        </div>
        {loading ? (
          <div className={s.empty}><Spinner /></div>
        ) : keys && keys.length ? (
          <table className={s.table}>
            <thead>
              <tr>
                <th>Label</th>
                <th>Secret</th>
                <th>Environment</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className={s.strong}>{k.label}</td>
                  <td className={s.mono} style={{ fontSize: 12 }}>{maskKey(k.secret || k.prefix)}</td>
                  <td>
                    <Badge tone={k.environment === 'live' ? 'orange' : 'teal'}>{k.environment}</Badge>
                  </td>
                  <td className={s.faint} style={{ fontSize: 12.5 }}>{timeAgo(k.created_at)}</td>
                  <td className={s.faint} style={{ fontSize: 12.5 }}>{k.last_used_at ? timeAgo(k.last_used_at) : 'never'}</td>
                  <td>
                    {k.revoked ? <Badge tone="red">revoked</Badge> : <Badge tone="green" dot>active</Badge>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {!k.revoked && k.id !== 'key_bootstrap' ? (
                      <button type="button" className={`${s.btn} ${s.btnDanger} ${s.btnSm}`} onClick={() => revoke(k.id)}>
                        <IconTrash size={13} /> Revoke
                      </button>
                    ) : k.id === 'key_bootstrap' ? (
                      <span className={s.faint} style={{ fontSize: 11.5 }}>shared</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No keys yet. Create one to get started.</Empty>
        )}
      </div>

      <div className={`${s.card} ${s.cardPad} ${s.revealItem}`} style={{ marginTop: 22, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <IconShield size={18} style={{ color: 'var(--teal)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <div className={s.h3} style={{ fontSize: 13.5 }}>Scopes & rotation</div>
          {IS_REAL ? (
            <p className={s.faint} style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 4 }}>
              Every key is scoped: <code className={s.mono}>read</code> and{' '}
              <code className={s.mono}>write</code> for protocol-level data,{' '}
              <code className={s.mono}>partner:read</code> for the endpoints bound to one partner, and{' '}
              <code className={s.mono}>keys:admin</code> / <code className={s.mono}>partner:admin</code>{' '}
              for operators. Scopes are server-assigned — a key cannot grant itself broader access.
              Minting a <code className={s.mono}>live</code> key takes{' '}
              <code className={s.mono}>keys:admin</code>, or the self-serve onboarding path in the
              account app, which issues exactly one{' '}
              <code className={s.mono}>read</code>+<code className={s.mono}>write</code> live key per
              account. Production rejects every <code className={s.mono}>tsk_test_</code> key.
              Revocation is immediate: a revoked key returns{' '}
              <code className={s.mono}>401</code>, and an out-of-scope call returns{' '}
              <code className={s.mono}>403</code>.
            </p>
          ) : (
            <p className={s.faint} style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 4 }}>
              Every key is scoped: <code className={s.mono}>read</code> (GET),{' '}
              <code className={s.mono}>write</code> (positions &amp; webhooks) and{' '}
              <code className={s.mono}>keys:admin</code> (key management). Scopes are server-assigned — a
              key cannot grant itself broader access, and minting <code className={s.mono}>live</code> keys
              requires the <code className={s.mono}>keys:live</code> scope. Revocation is immediate: a
              revoked key returns <code className={s.mono}>401</code>, and an out-of-scope call returns{' '}
              <code className={s.mono}>403</code>.
            </p>
          )}
        </div>
      </div>

      {/* create modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={newSecret ? 'Key created' : 'Create API key'}>
        {newSecret ? (
          <>
            <div className={`${s.card} ${s.cardPad}`} style={{ borderLeft: '3px solid var(--teal)', background: 'var(--bg-inset)' }}>
              <div className={s.h3} style={{ fontSize: 13 }}>Copy this secret now — it won’t be shown again</div>
              <code className={s.mono} style={{ display: 'block', marginTop: 10, fontSize: 12.5, wordBreak: 'break-all', color: 'var(--teal)' }}>
                {newSecret.secret}
              </code>
              <div className={s.row} style={{ marginTop: 12 }}>
                <CopyButton text={newSecret.secret} label="Copy secret" />
                <button
                  type="button"
                  className={`${s.btn} ${s.btnSecondary} ${s.btnSm}`}
                  onClick={() => { setApiKey(newSecret.secret); setCreateOpen(false); }}
                >
                  Use as portal key
                </button>
              </div>
            </div>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => setCreateOpen(false)}>
              Done
            </button>
          </>
        ) : (
          <form onSubmit={createKey} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className={s.field}>
              <label className={s.fieldLabel} htmlFor="key-label">Label</label>
              <input
                id="key-label"
                className={s.input}
                placeholder="e.g. Production backend"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className={s.field}>
              <label className={s.fieldLabel}>Environment</label>
              {IS_REAL ? (
                <>
                  <div className={s.envSwitch} style={{ maxWidth: 260 }}>
                    <button type="button" className={`${s.envBtn} ${s.envBtnActive}`}>Test</button>
                  </div>
                  <div className={s.faint} style={{ fontSize: 12, lineHeight: 1.6, marginTop: 8, maxWidth: 520 }}>
                    This portal creates <code className={s.mono}>test</code> keys only, through the
                    admin proxy. A production Partner API rejects{' '}
                    <code className={s.mono}>tsk_test_</code> keys, so a key created here is for a
                    non-production stand. Your <code className={s.mono}>tsk_live_</code> key is created
                    in the{' '}
                    <a href={ACCOUNT_APP_URL} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--blue-strong)' }}>
                      account app
                    </a>
                    .
                  </div>
                </>
              ) : (
                <div className={s.envSwitch} style={{ maxWidth: 260 }}>
                  <button type="button" className={`${s.envBtn} ${env === 'test' ? s.envBtnActive : ''}`} onClick={() => setEnv('test')}>Test</button>
                  <button type="button" className={`${s.envBtn} ${env === 'live' ? s.envBtnActive : ''}`} onClick={() => setEnv('live')}>Live</button>
                </div>
              )}
            </div>
            <div className={s.row} style={{ justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => setCreateOpen(false)}>Cancel</button>
              <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={creating}>
                {creating ? <Spinner /> : <IconKey size={14} />} Create
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
