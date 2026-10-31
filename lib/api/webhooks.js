/**
 * Webhook signing + dispatch.
 *
 * Signature scheme (documented + verifiable in the portal):
 *   Webhook-Signature: t=<unix>,v1=<hmac_sha256(secret, t + "." + body)>
 *
 * This public sandbox never performs a real network request. Reserved example
 * receivers simulate success; every other receiver records a blocked delivery.
 */

import { createHmac } from 'node:crypto';
import { getStore, createCapped, filter, randomId } from './store.js';
import { checkUrl } from './urlguard.js';

// Reserved documentation hosts (RFC 2606/6761) that can never receive a real
// delivery — dispatch simulates success for these in the sandbox.
const SIM_HOSTS = ['example.com', 'example.org', 'example.net'];
function isSimulatedTarget(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      SIM_HOSTS.includes(host) ||
      host.endsWith('.example') ||
      host.endsWith('.test') ||
      host.endsWith('.invalid')
    );
  } catch {
    return false;
  }
}

/** Compute the `t=...,v1=...` signature header value for a body. */
export function sign(secret, body, t) {
  const mac = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${mac}`;
}

/** A webhook record safe for list responses (secret masked). */
export function publicWebhook(webhook) {
  return { ...webhook, secret: maskWebhookSecret(webhook.secret) };
}

/** Mask a signing secret: `whsec_...a1b2`. */
export function maskWebhookSecret(secret) {
  if (!secret) return secret;
  return `whsec_...${String(secret).slice(-4)}`;
}

/**
 * Build and sign a sandbox event. No URL/key/configuration enables real egress.
 * @returns {Promise<{delivery: object, evt: object, signature: string}>}
 */
export async function dispatch(webhook, event, payload) {
  const evt = {
    id: randomId('evt'),
    type: event,
    created_at: new Date().toISOString(),
    data: payload,
  };
  const body = JSON.stringify(evt);
  const t = Math.floor(Date.now() / 1000);
  const signature = sign(webhook.secret, body, t);

  // Re-validate the target at dispatch time (defense in depth against a
  // stored URL that would fail today's guard).
  const guard = checkUrl(webhook.url);

  const simulated = guard.ok && isSimulatedTarget(guard.url);
  const status = simulated ? 'delivered' : 'failed';
  const latency_ms = simulated ? 42 + (evt.id.length % 40) : 0;

  const delivery = createCapped('deliveries', {
    id: randomId('del'),
    object: 'delivery',
    webhook_id: webhook.id,
    url: webhook.url,
    event,
    payload: evt,
    signature,
    status,
    attempts: 0,
    simulated,
    blocked: !simulated,
    failure_reason: simulated ? null : 'Real webhook delivery is disabled in the public sandbox.',
    at: new Date().toISOString(),
    latency_ms,
  });

  return { delivery, evt, signature };
}

/**
 * Fire-and-forget fan-out of an event to every active webhook subscribed to it.
 * Never throws; deliveries are recorded asynchronously.
 * @returns {number} number of endpoints dispatched to.
 */
export function emit(event, payload) {
  const targets = filter('webhooks', (w) => w.active && (w.events.includes('*') || w.events.includes(event)));
  for (const webhook of targets) {
    dispatch(webhook, event, payload).catch(() => {});
  }
  return targets.length;
}

/** All supported webhook event types. */
export const SUPPORTED_EVENTS = [
  'position.opened',
  'position.active',
  'position.rebalanced',
  'position.withdrawn',
  'position.closed',
  'yield.threshold',
  'system.status',
];

/** Convenience: list deliveries, optionally filtered by webhook. */
export function listDeliveries(webhookId) {
  const all = getStore().deliveries;
  return webhookId ? all.filter((d) => d.webhook_id === webhookId) : all;
}
