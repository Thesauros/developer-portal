# Running the account application

Next.js 16 / React 19 on Node.js 20.20 or newer. The application serves its own
public routes; a standalone deployment on Vercel or `next start` needs no URL
rewrites. The separate `Thesauros/developer.thesauros.io` repository contains
the Partner API backend and SDKs.

## Local setup

```bash
npm ci
cp .env.example .env.local
```

Set `BETTER_AUTH_SECRET` to a unique secret of at least 32 characters,
`BETTER_AUTH_URL` to the exact public origin, and `THESAUROS_AUTH_DB` to an
absolute persistent path outside the checkout. Keep the environment file private.
For Turso, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` instead of relying on
local SQLite. Both authentication and simulated account balances use this storage.

```bash
node --env-file=.env.local scripts/init-auth.mjs
npm test
npm run build
npm run test:routes
npm start -- --hostname 127.0.0.1 --port 8879
```

The example origin is `http://localhost:8879`; open `/app/individual` or
`/app/institution` directly. For editing, use `npm run dev -- --port 8879`.

## Native routes

| Public URL | Responsibility |
| --- | --- |
| `/` | Redirect to `/app` |
| `/app` | Wallet entry; accepts existing `mode` / `next` query parameters |
| `/app/individual` | Wallet sign-in or authenticated Individual workspace |
| `/app/institution` | Coming soon |
| `/app/api` | Authenticated simulated account ledger |
| `/app/live` | Authenticated market and protocol reads |
| `/api/auth/*` | Wallet challenge, signature verification, session and logout |
| `/api/v1/*` | Existing developer sandbox API |
| `/monitoring` | Institution Coming soon |
| `/_next/*`, `/brand/*` | Next.js assets and application artwork |

`app/app/[mode]/page.jsx` creates the account URL in Next.js itself.
`NEXT_PUBLIC_BASE_PATH` is no longer read. Remove it from deployment settings;
even a stale `/developers` value no longer prefixes routes or API calls.

Old `/customer/*` and `/developers/customer/*` links redirect to `/app/*`.
Old `/developers/api/*` links redirect to `/api/*` with method-preserving 308s.
`/developers` redirects to Institution. These are bookmark compatibility rules;
current navigation and requests use native paths directly.

## Vercel

Use the Next.js framework preset, repository root, and the normal `npm run build`
command. Do not copy the old `/developers/customer` proxy mappings into Vercel.
Use persistent Turso storage for deployed accounts, with the existing wallet
schema initialized from a checkout before serving sign-ins. SQLite in the
serverless filesystem is not persistent account storage.

Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in Vercel's Production
environment (and use a separate database for Preview). A self-hosted libSQL
server with HTTPS and token authentication is also supported. Initialize the
schema using `node --env-file=.env.local scripts/init-auth.mjs` with the same
database credentials before deploying. Missing database configuration fails
the build explicitly instead of falling back to a local SQLite file.

Only disposable market/rebalance caches use Vercel's writable temporary
directory. Accounts, sessions and workspaces always use the external database.

Set `BETTER_AUTH_URL` to the exact HTTPS origin users visit, for the relevant
Production or Preview environment. Preserve a stable `BETTER_AUTH_SECRET`.
WalletConnect uses the existing public project by default; an override is
available through `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.

Public links default to `https://thesauros.io` and `https://docs.thesauros.io`.
Override `NEXT_PUBLIC_MARKETING_URL` / `NEXT_PUBLIC_DOCS_URL` at build time for a
combined preview. `/contact` and `/docs/*` also redirect to those sites for old
relative links. Rebuild when changing these public settings.

## Existing proxy deployments: migrate before switching the application

Remove rewrites that translate `/app/*` into `/developers/customer/*`. Keeping
that old mapping creates a redirect loop when the application sends the browser
back to `/app/*`. Forward requests to the Next process with their original paths.
A complete standalone nginx example is in `deploy/nginx-local.conf`.

For a shared marketing host, forward `/app`, `/api`, `/_next`, `/brand`,
`/monitoring`, and legacy `/customer` / `/developers` paths to Next unchanged.
Keep marketing pages and `/docs` served by their existing applications. Preserve
query strings, bodies, public Host/scheme, cookies and all `Set-Cookie` headers.
Overwrite `X-Real-IP` with the actual client address. Do not cache account/API
responses. Ordinary proxying can still be used; it no longer changes account URLs.

The shared preview's `serve.py` implements that pass-through. Its service uses
`scripts/release-preview.sh` to build into a separate release directory before
restarting. `THESAUROS_NEXT_DIST` must match at build/start. A git push alone does
not update this preview.

The separate `app-v2-dev` server also has a deployment service installed outside
Git. Update its nginx rules and the installed deployment service files, including
`health.mjs`, as described in `deploy/SERVER.md` before deploying these routes.
The health check supports both native wallet releases and previous prefixed
releases when rolling back.

## Persistence and validation

Back up the database with SQLite-aware tooling or the database provider before
schema changes. This route migration adds no tables and preserves existing
wallet identities and sessions. The public-source cache remains separate from
Git and the public assets.

`npm test` checks ledger behaviour and wallet authentication against SQLite and
libSQL. After a production build, `npm run test:routes` starts an isolated Next
server, checks native pages/assets without a proxy, signs in with an ephemeral
wallet and verifies session/logout protection. It uses a temporary database,
sends no transactions and does not touch deployed accounts.

Individual deposits remain simulated. Institution remains Coming soon. See
[account operation](ACCOUNT-WORKSPACES.md) for authentication and data boundaries.
