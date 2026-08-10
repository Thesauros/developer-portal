# Thesauros Developer Portal

Developer portal for Thesauros non-custodial stablecoin yield: dashboard UI,
API reference with a live Try-it console, and the built-in sandbox API.

This is the frontend half of the former `developer.thesauros.io` monorepo.
The real backend (partner API, NestJS + Postgres) lives in
`Thesauros/developer.thesauros.io`; the API contract source of truth is its
`spec/developer-platform-architecture.md`. The marketing site lives in
`../b2b.thesauros.io`.

## What's inside

```
developer-portal/
├── app/
│   ├── page.jsx                 Portal UI (client SPA shell)
│   ├── layout.jsx               Root layout (Onest + JetBrains Mono)
│   ├── platform.module.css      Portal design system (dark console)
│   ├── views/                   Overview, Quickstart, ApiReference (live Try-it),
│   │                            ApiKeys, Users, Webhooks, Analytics & Advisor,
│   │                            Reconciliation, Usage, Vaults, Status
│   ├── ui/                      CodeBlock + syntax highlight, SVG charts, primitives
│   ├── lib/                     Client-side API helper + formatters, icon set
│   ├── data/                    Endpoint catalog + code samples (TS/Python/cURL)
│   └── api/v1/                  Built-in sandbox REST API — 31 route handlers
└── lib/api/                     Sandbox core: auth, rate limiting, simulation engine,
                                 webhook signing/dispatch, SSRF guard, HTTP envelopes
```

## Running locally

```bash
npm install
npm run dev
```

- Portal: http://localhost:3000
- Sandbox API base: http://localhost:3000/api/v1
- OpenAPI: http://localhost:3000/api/v1/openapi.json

Production build:

```bash
npm run build
npm run start
```

## The sandbox

The built-in API is a deterministic, single-instance simulation of the
Thesauros routing engine. Every endpoint behaves per the contract, but no
funds move and state resets on process restart. A shared bootstrap key is
seeded for the portal:

```
tsk_test_thesauros_sandbox_0000000000000000
```

APY values are decimal fractions (`0.052` == 5.2%).

## Integrating with real data

The portal is wired to swap data sources without code changes:

1. **Client calls** (`app/lib/api.js`) read `NEXT_PUBLIC_API_BASE`
   (default `/api/v1` — the built-in sandbox). Point it at a real Thesauros
   API deployment to show live data.
2. **Partner endpoints** are proxied by Next.js rewrites
   (`/api/v1/partners/*`, `/api/v1/partner/*`) to `PARTNER_API_URL`
   (default `http://localhost:3001`) — the NestJS backend from
   `Thesauros/developer.thesauros.io`.

Both are set in `.env` (see `.env.example`).

## API surface (sandbox v1)

| Area | Endpoints |
| --- | --- |
| Keys | `POST /keys`, `GET /keys`, `DELETE /keys/:id` |
| Users | `POST /users`, `GET /users`, `GET /users/:id`, `PATCH /users/:id`, `GET /users/:id/positions`, `GET /users/:id/ledger` |
| Vaults | `GET /vaults`, `GET /vaults/:id` |
| Yield | `GET /yield`, `GET /yield/:asset` |
| Positions | `POST /positions`, `GET /positions`, `GET /positions/:id`, `POST /positions/:id/withdraw`, `GET /positions/:id/history` |
| Rebalances | `GET /rebalances` |
| Webhooks | `POST /webhooks`, `GET /webhooks`, `DELETE /webhooks/:id`, `POST /webhooks/:id/test`, `GET /webhooks/events` |
| Reconciliation | `GET /reconciliation/ledger`, `GET /reconciliation/balances`, `GET /reconciliation/report`, `GET /reconciliation/snapshots` |
| Analytics | `GET /analytics/uplift`, `GET /analytics/decisions`, `GET /analytics/signals`, `GET /analytics/regime`, `GET /analytics/advisor` |
| Telemetry | `GET /usage`, `GET /status` (public), `GET /openapi.json` (public) |

Cross-cutting behavior:

- Auth: `Authorization: Bearer tsk_test_... | tsk_live_...`
- Scopes: `read` (GET), `write` (mutations), `keys:admin` (key management).
- Envelopes: single `{object,data,meta?}`, list `{object:"list",data,meta}`,
  error `{error:{code,message,doc_url}}`.
- Pagination: `?limit=&cursor=` on lists; `meta.next_cursor` is opaque.
- Idempotency: `Idempotency-Key` header on `POST` replays the original response.
- Rate limiting: token bucket per key (120/min test, 600/min live) plus an
  IP-based limit on failed auth. `429` carries `Retry-After`.
- Webhooks: HMAC-SHA256 signed (`Webhook-Signature: t=...,v1=...`); endpoint
  URLs are SSRF-guarded (loopback/private/link-local/metadata rejected).
