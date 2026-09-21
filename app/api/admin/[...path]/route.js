/**
 * Server-side admin proxy for the real-mode Partner API surface.
 *
 * Real mode needs credentials the portal must not ship to the browser:
 * `keys:admin` for the API Keys view, and a partner-scoped credential for the
 * partner views (Users, Analytics). Both are read from PARTNER_ADMIN_KEY here
 * and attached on the server, so the client calls /api/admin/* with no
 * Authorization header of its own.
 *
 * Sandbox mode never touches this route: it calls the built-in API at
 * /api/v1/* with the public bootstrap key.
 *
 * The forwardable surface is an allowlist of exactly the calls the real-mode
 * views make — key management (GET/POST /keys, DELETE /keys/:id) and the
 * read-only partner endpoints (GET /partner/summary, GET /partner/users,
 * GET /partner/user/:id/positions) — plus the pagination params they use.
 * Everything else is rejected, so this handler is a narrow proxy rather than a
 * general tunnel to PARTNER_API_URL carrying the admin key.
 */

export const dynamic = 'force-dynamic';

/** Upstream base for the Partner API (same default as next.config.mjs). */
function upstreamBase() {
  return process.env.PARTNER_API_URL || 'http://localhost:3001';
}

/** Read-only partner endpoints rendered by the Users and Analytics views. */
function isPartnerRead(seg) {
  if (seg[0] !== 'partner' || seg.length < 2) return false;
  if (seg.length === 2) return seg[1] === 'summary' || seg[1] === 'users';
  return seg.length === 4 && seg[1] === 'user' && seg[2].length > 0 && seg[3] === 'positions';
}

/** Allowed path shapes per method, as decoded path segments. */
const ALLOWED = {
  GET: (seg) => (seg.length === 1 && seg[0] === 'keys') || isPartnerRead(seg),
  POST: (seg) => seg.length === 1 && seg[0] === 'keys',
  DELETE: (seg) => seg.length === 2 && seg[0] === 'keys' && seg[1].length > 0,
};

/** Query params this proxy forwards; the upstream validates their values. */
const FORWARDED_PARAMS = ['limit', 'cursor'];

function respond(status, body, headers = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function errorResponse(status, code, message) {
  return respond(status, { error: { code, message } });
}

/**
 * Normalise the create-key payload to the two fields the endpoint accepts.
 *
 * `environment` is pinned to `test` and the client's value is ignored. This
 * route carries PARTNER_ADMIN_KEY (a `keys:admin` credential) and is reachable
 * by any browser that can load the portal — it authenticates the *portal*, not
 * the visitor. Now that the Partner API honours `environment: "live"` from a
 * `keys:admin` caller, forwarding a client-supplied `"live"` here would let an
 * anonymous visitor mint a production key. The portal has no session system, so
 * it cannot attribute a live key to anyone: live keys come from the account app's
 * self-serve onboarding path (POST /api/v1/onboarding/partners), never from here.
 */
function createKeyPayload(raw) {
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    label: typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 100) : 'Untitled key',
    environment: 'test',
  };
}

async function forward(request, segments) {
  // Allowlist first: a path this portal never calls is rejected the same way
  // whether or not the admin key is configured.
  const allowed = ALLOWED[request.method];
  if (!allowed || !allowed(segments)) {
    return errorResponse(
      404,
      'not_found',
      'This route proxies key management (GET/POST /keys, DELETE /keys/:id) and the read-only partner endpoints only.',
    );
  }

  const adminKey = process.env.PARTNER_ADMIN_KEY;
  if (!adminKey) {
    return errorResponse(
      503,
      'admin_key_not_configured',
      'Real-mode Partner API access is unavailable: PARTNER_ADMIN_KEY is not set on the portal server.',
    );
  }

  // Concatenate rather than URL-resolve so a PARTNER_API_URL with a path prefix
  // behaves exactly like the /api/v1/real/* rewrite in next.config.mjs.
  const base = upstreamBase().replace(/\/+$/, '');
  let url;
  try {
    url = new URL(`${base}/api/v1/${segments.map(encodeURIComponent).join('/')}`);
  } catch {
    return errorResponse(502, 'upstream_misconfigured', 'PARTNER_API_URL is not a valid absolute URL.');
  }
  for (const name of FORWARDED_PARAMS) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) url.searchParams.set(name, value);
  }

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${adminKey}`,
  };
  let body;
  if (request.method === 'POST') {
    let parsed = null;
    try {
      parsed = await request.json();
    } catch {
      /* empty or non-JSON body -> defaults below */
    }
    body = JSON.stringify(createKeyPayload(parsed));
    headers['Content-Type'] = 'application/json';
  }

  let upstream;
  try {
    upstream = await fetch(url, { method: request.method, headers, body, cache: 'no-store' });
  } catch (e) {
    return errorResponse(502, 'upstream_unreachable', `Could not reach the Partner API: ${e.message}`);
  }

  const text = await upstream.text();
  const contentType = upstream.headers.get('content-type');
  return new Response(text || null, {
    status: upstream.status,
    headers: {
      'Cache-Control': 'no-store',
      ...(contentType ? { 'Content-Type': contentType } : { 'Content-Type': 'application/json' }),
    },
  });
}

async function segmentsOf(ctx) {
  const { path } = await ctx.params;
  if (Array.isArray(path)) return path;
  return path ? [path] : [];
}

export async function GET(request, ctx) {
  return forward(request, await segmentsOf(ctx));
}

export async function POST(request, ctx) {
  return forward(request, await segmentsOf(ctx));
}

export async function DELETE(request, ctx) {
  return forward(request, await segmentsOf(ctx));
}
