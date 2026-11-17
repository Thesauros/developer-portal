/**
 * Syntax policy for public sandbox webhook examples, not network authorization.
 * Dispatch never connects; real delivery belongs to the authenticated Partner API.
 */
import { isIP } from 'node:net';

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata', 'instance-data']);
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;

export function checkUrl(raw) {
  if (typeof raw !== 'string' || CONTROLS.test(raw))
    return { ok: false, reason: 'url must not contain control characters.' };
  let u;
  try { u = new URL(raw); } catch {
    return { ok: false, reason: 'url is not a valid URL.' };
  }
  if (!['https:', 'http:'].includes(u.protocol))
    return { ok: false, reason: 'url must use http or https.' };
  if (u.username || u.password)
    return { ok: false, reason: 'url must not contain credentials.' };

  // Deny every IP literal, including normalized integer/hex IPv4 and mapped
  // IPv6. The synthetic sandbox accepts named example endpoints only.
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '');
  if (isIP(host) || !host.includes('.') || BLOCKED_HOSTNAMES.has(host) ||
      ['.localhost', '.local', '.internal', '.lan', '.home'].some(suffix => host.endsWith(suffix)))
    return { ok: false, reason: 'url must be a named, non-internal sandbox endpoint.' };
  u.hostname = host;
  return { ok: true, url: u.toString() };
}

export function assertSafeUrl(raw) {
  const result = checkUrl(raw);
  if (!result.ok) throw Object.assign(new Error(result.reason), { code: 'invalid_request' });
  return result.url;
}
