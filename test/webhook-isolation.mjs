import assert from 'node:assert/strict';
import { checkUrl } from '../lib/api/urlguard.js';
import { dispatch, emit, sign } from '../lib/api/webhooks.js';
import { getStore } from '../lib/api/store.js';

const savedFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = async () => { fetches++; throw new Error('Sandbox must not fetch'); };
const hook = { id: 'audit-hook', secret: 'isolated-signing-fixture', active: true, events: ['*'] };
try {
  for (const url of [
    'http://127.0.0.1/hook', 'http://2130706433/hook', 'http://0x7f000001/hook',
    'http://[::1]/hook', 'http://[::ffff:127.0.0.1]/hook', 'http://[::ffff:7f00:1]/hook',
    'http://10.0.0.1/hook', 'http://[fd00::1]/hook', 'http://metadata.google.internal./hook',
    'http://localhost./hook', 'http://service.local./hook', 'http://internal/hook',
    'https://user:password@example.com/hook', 'https://example.com/\r\nHeader: value',
  ]) {
    assert.equal(checkUrl(url).ok, false, url);
    const { delivery } = await dispatch({ ...hook, url }, 'system.status', { fixture: true });
    assert.equal(delivery.status, 'failed');
    assert.equal(delivery.blocked, true);
    assert.equal(delivery.attempts, 0);
  }
  for (const url of ['https://receiver.example.com/hook', 'http://private-resolver.attacker.com/hook']) {
    assert.equal(checkUrl(url).ok, true, 'named syntax is not network authorization');
    const { delivery } = await dispatch({ ...hook, url }, 'system.status', { fixture: true });
    assert.equal(delivery.blocked, true);
    assert.equal(delivery.simulated, false);
    assert.match(delivery.failure_reason, /disabled/);
  }
  const { delivery, evt, signature } = await dispatch({ ...hook, url: 'https://example.com/hook' },
    'system.status', { fixture: true });
  assert.equal(delivery.status, 'delivered');
  assert.equal(delivery.simulated, true);
  assert.equal(delivery.attempts, 0);
  const timestamp = signature.match(/^t=(\d+),/)[1];
  assert.equal(signature, sign(hook.secret, JSON.stringify(evt), Number(timestamp)));
  getStore().webhooks.push({ ...hook, url: 'https://receiver.company.com/hook' });
  assert.ok(emit('system.status', { fixture: true }) > 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches, 0, 'direct dispatch and emit cannot perform real egress');
  console.log('PASS: sandbox webhook isolation, canonical literal denial, simulation/signature and fan-out; zero outbound requests.');
} finally {
  globalThis.fetch = savedFetch;
}
