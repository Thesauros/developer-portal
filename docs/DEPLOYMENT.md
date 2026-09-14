# Running the account application

The app uses Next.js 16 and React 19 on Node.js 20.20 or newer. It needs a
writable, persistent SQLite or Turso database and a server process; it is not a static
export. The separate `Thesauros/developer.thesauros.io` repository contains the NestJS backend and Postgres configuration.
Run the following commands **from this repository root**.

```bash
npm ci
cp .env.example .env.local
```

Set `BETTER_AUTH_SECRET` to a locally generated random secret of at least 32
characters, `BETTER_AUTH_URL` to the public origin, and `THESAUROS_AUTH_DB` to
an absolute persistent path outside the source checkout. Keep `.env.local`
private. Use `NEXT_PUBLIC_BASE_PATH=/developers` for the route layout below.

```bash
node --env-file=.env.local scripts/init-auth.mjs
npm test
npm run build
npm run start -- --hostname 127.0.0.1 --port 18880
```

For local editing, replace the last two commands with `npm run dev --
--hostname 127.0.0.1 --port 18880`.

## Public routes

The current UI uses `/app/` as its public account entry. Its internal Next.js
pages sit under `/developers/customer`. A reverse proxy is required for the
complete login and navigation flow; opening the Next port alone is insufficient.
The marketing preview's `serve.py` already implements this mapping.

| Public path                       | Next.js upstream path                            |
| --------------------------------- | ------------------------------------------------ |
| `/app` and `/app/`                | `/developers/customer`                           |
| `/app/individual`                 | `/developers/customer/individual`                |
| `/app/institution`                | `/developers/customer/institution`               |
| `/app/*`                          | `/developers/customer/*`                         |
| `/developers` and `/developers/*` | Same path, including auth, API and static assets |
| `/monitoring` and `/monitoring/`  | `/developers/monitoring`                         |
| `/monitoring/*`                   | `/developers/monitoring/*`                       |

Preserve the query string, request body, cookies and response `Set-Cookie`
headers. Forward the public Host and scheme. Do not cache authenticated pages
or API responses. Serve marketing and documentation separately on this origin.
For a local proxy at `http://localhost:8879`, set `BETTER_AUTH_URL` to exactly
that origin; an nginx example is provided in `deploy/nginx-local.conf`.

Use the same `NEXT_PUBLIC_BASE_PATH` at build and start. If using
`THESAUROS_NEXT_DIST`, it must also match at build and start. The existing
`scripts/release-preview.sh` is specific to Pavel's shared preview service;
other deployments should use their own service manager. A git push alone
does not restart or deploy that preview.

## Persistence and connected services

Run auth initialization before the first build/start and after adding wallet authentication. With Turso, set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN; initialization and workspace writes use libSQL. Back up the SQLite
database using SQLite-aware tooling, and persist its directory across releases.
The source cache is stored in `../private-state/live-cache` relative to the
process working directory. Tests use recorded public fixtures and mock fetches;
they do not require production keys.

The account UI reads public protocol and market feeds. Its test deposits are
simulated and isolated by account. Institution currently shows Coming soon. The retained developer tools use the
separate shared integration sandbox. An actual partner integration still needs
Partner API configuration and credentials; signing up does not provision one.

See [account operation](ACCOUNT-WORKSPACES.md) for wallet authentication, migration,
source data and current account boundaries. No private accounts,
environment files or running database are included in this repository.
