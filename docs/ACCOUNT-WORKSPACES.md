# Unified accounts and live data

The public preview routes are /app (email/password login), /app/individual and /app/institution (session-protected workspaces). /developers opens the Institution login or redirects an existing session into embedded developer tools. Existing hash links (reference, keys, webhooks, etc.) retain their destination. /monitoring opens protocol statistics inside the signed-in account.

## Setup

Install dependencies with npm ci. Configure BETTER_AUTH_SECRET, BETTER_AUTH_URL, THESAUROS_AUTH_DB and NEXT_PUBLIC_BASE_PATH in .env.local; never expose the secret or database through public assets. Run `node --env-file=.env.local scripts/init-auth.mjs` before the production build. For the shared preview, deploy with `bash scripts/release-preview.sh`; it builds into an isolated directory before switching the service. `THESAUROS_NEXT_DIST` must match at build and start. Do not overwrite a build directory currently being served.

Accounts, hashed passwords, session tokens, recovery-key hashes and per-user test workspaces persist in SQLite under ../private-state. Test transaction requests preserve idempotency across reloads and restarts. Creating an account never seeds company/customer capital. Each account can explicitly receive test funds once. Recovery keys are displayed once on signup; password recovery invalidates all existing sessions. No email delivery provider is configured in this preview.

The public IP preview currently uses HTTP. It is a review environment. For production configure the HTTPS origin and secure cookies (automatically derived from BETTER_AUTH_URL), verify the company domain, configure email delivery/verification and operational account administration. Registration does not verify ownership of an email address or business identity.

## Data

Authenticated GET /customer/live?kind=protocol normalizes https://bastardgreeks.thesauros.io/api/networks and /api/dashboard?network= on the server. GET ?kind=markets returns a curated set of actual stablecoin lending pools from https://yields.llama.fi/pools. GET ?kind=history&pool= accepts only pool identifiers in that set. /monitoring/data is a compatibility entry for the actual protocol feed; it no longer returns the old monitor simulation.

Underlying vault assets retain their token denomination. Percent APYs are not divided or multiplied in the monitor adapter. Failed reads produce null values. Lifetime snapshots retain their original timestamp and block range. No synthetic vault-rate history is generated. External market TVL is labeled as market liquidity in USD, never as Thesauros assets.

Source fetches are cached on the server (protocol 60 seconds, markets 10 minutes, histories one hour). Concurrent requests share an in-flight fetch. Last successful responses persist outside the public tree, retain fetchedAt/source metadata and are marked stale on refresh failure. If a successful response omits previously indexed lifetime records or events, those records stay available with their original timestamps and a retained-record label. Current balances and APYs are never filled from historical records. API responses and authenticated pages are private/no-store through the preview proxy.

Individual wallets use the injected EIP-1193 provider. Wallet reads call asset, decimals, balanceOf and convertToAssets at a common block; no signing or transfer method is used. Account changes, chain changes, cancellation, unsupported chains and disconnect invalidate old reads. Wallet selection is not used as login or proof of ownership.

## Developer tools

The existing API sandbox and SDK contract are retained. Their shared sample data is explicitly labeled inside Institution; sample API customers are not connected company customers. Connecting an external partner API to a company still requires partner credentials and deployment configuration. The new product UI does not infer company access from signup alone.

## Verification

Run `npm test` from the repository root: financial ledger invariants, recorded public data
fixtures, missing/error values, percent/token units, event identity, source
scope and cached-source behavior. See [deployment](DEPLOYMENT.md) for setup.

The original preview also has deployment-specific browser checks covering
signup, login, isolation, recovery, role boundaries and desktop/mobile journeys.
Those scripts and their private account/session state remain in the preview
workspace; they are not dependencies of this repository's tests or build.
