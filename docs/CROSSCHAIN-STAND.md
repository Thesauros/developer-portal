# Cross-chain stand — delivery contract

Change: `crosschain-stand-20261028`. Branch: `сcrosschain` (initial Cyrillic `с`).

## Outcome and evidence

An isolated deployment of the account application connects to
`https://api-cross-chain-production.up.railway.app` and the existing cross-chain
stand in `optimized-rebalancer-contracts/deployments/{base,arbitrum}/crosschain.json`.
Base is the hub; Arbitrum is the spoke. This is an asynchronous EpochVault,
so replacing the legacy ERC-4626 vault addresses is insufficient.

The cross-chain view must be reachable from the account navigation, show the
configured contracts, epoch, NAV, user requests and allocation. The supplied API
is a NestJS Lending API, **not** the ops indexer: its actual routes are `/health`
and `/lending?network=Base|Arbitrum`. Cross-chain state is read directly from the
contracts. No sandbox or legacy-vault data may stand in for cross-chain data.

## Acceptance criteria

1. Pin hub/spoke addresses and implementation hashes to the stand manifests.
2. Use a same-origin, GET-only proxy with a fixed HTTPS upstream, bounded timeouts,
   an explicit route allowlist, and no forwarded credentials or redirects.
3. Verify contract code and identity before showing cross-chain state; reject
   backend lending rows whose vault identity does not match the stand.
4. Display API unavailability explicitly and disable new financial requests when
   health or identity cannot be established. Never interpret missing amounts as zero.
5. Support exact USDC approval, deposit requests, share-denominated redeem requests,
   claim and cancellation. Re-read chain state, verify proxy implementation and asset,
   simulate each operation, check the connected wallet and Base chain, and wait for a
   matching successful receipt. Approval requires a separate deposit confirmation.
6. Keep an unresolved submission locked across reload and expose a receipt link.
7. Run the existing test suite, focused cross-chain tests, production build and
   native-route/session tests. Send no funded transactions during validation.
8. Per the user's subsequent instruction, run locally with an isolated SQLite
   database and provide a server deployment configuration. Remote deployment is
   performed by the user.

## Delivery and rollout

Product validates this narrow deployment/integration request; no new market
discovery is needed (user supplied the outcome, repository, backend and contracts).
CTO implements; QA checks the criteria above; Security checks the proxy and wallet
trust boundaries; Orchestrator records the gates. User authorization covers preparing
and deploying the stand. A funded end-to-end transaction requires a wallet owner.

Reuse: existing `lib/vault-*` safety patterns, the cross-chain API/ABI in
`thesauros-app` branch `feat/crosschain-vault`, and the existing container image.
Success is a reachable isolated build with matching contracts and backend identity;
an unhealthy or incorrectly mapped backend blocks financial release acceptance.
Rollback: stop the stand container; no contract mutation or production migration.

## Initial external checks (2026-10-28)

- Railway API returns HTTP 502, `Application failed to respond`, at `/`, `/api`,
  `/health` and `/swagger-json`, also outside the sandbox.
- Local Railway CLI is unauthorized.
- Vercel project `developer-portal` exists and serves `developer.thesauros.io`.
- Its Preview environment has no Turso storage configured (Production does).

## Verified current state

The API recovered during preparation. Its Swagger schema at `/swagger-json`
does not publish EpochVault, epoch or request routes. Base `/lending` reports
legacy vault `0x3C7739173cca612B6394EE57131458185A5beC44`, not this deployment.
Its amounts and rates are rejected for the cross-chain view. New approvals,
deposit requests and redeem requests remain disabled until both network mappings
match. Claims/cancellations use fresh contract reads and simulation.

Base RPC verified the pinned proxy code, EIP-1967 implementation, linked library,
USDC and accountant. Epoch 277 and both chain allocations were readable at the
time of preparation. Snapshots identify their source and block number.

The supplied backend needs its USDC mappings updated to these strategies (or the
hub EpochVault where its implementation supports that ABI):

| Network  | Strategy                                     | Hub vault                                    |
| -------- | -------------------------------------------- | -------------------------------------------- |
| Base     | `0x4cBb4042F79e150F99D3Da4d666e10fdB0711F33` | `0x33c4F5Efc49DCEa72bfA8Fe62e5Cb7B3226d7cB6` |
| Arbitrum | `0xD211BfFAB29e60c17a2B406B3FAf3d0E29282B71` | None: the spoke has a ChainAgent             |

Do not configure an ERC-4626-only backend to treat EpochVault as a synchronous
vault. The backend operator must validate its ABI and indexing configuration.
`npm run check:crosschain` exits nonzero while the mappings are inconsistent.

Requests created by this view are tracked by their receipt event IDs in browser
storage and verified on chain. Add an older request ID manually to recover it.
This is explicitly not full indexed history. In-flight bridge totals remain
unknown until an indexer is connected. Instant redemption is not exposed here.

## Local stand

Use Node.js 22 (at least 22.21). Install dependencies with the same Node version
used to run the app; `better-sqlite3` is a native module.

```bash
npm ci
npm run crosschain:local -- --build
```

The launcher creates `.env.crosschain.local` with a unique random secret (0600),
initializes `private-state/crosschain/accounts.sqlite`, builds `.next-crosschain`,
and starts `http://127.0.0.1:18890/app/individual#crosschain`. Existing environment
files, accounts and builds are not overwritten. Subsequent starts can omit
`--build`; include it after source edits. The local launcher never uses Turso.
Stop with Ctrl-C. The database persists. Use `--init-only` to initialize without
starting the server.

Verification:

```bash
npm test
npm run test:crosschain
THESAUROS_NEXT_DIST=.next-crosschain npm run test:routes
npm run check:crosschain
```

## Remote server handoff

Docker Compose provides a separate database volume and loopback port. Create
`deploy/crosschain.env` from the example and fill in the public HTTPS origin and
a new server secret. Keep the file private; it is excluded from Git and the image.
The public origin is a runtime setting, not a build-time wallet credential.

```bash
cp deploy/crosschain.env.example deploy/crosschain.env
# Fill settings and restrict permissions before continuing.
chmod 600 deploy/crosschain.env
docker compose --env-file deploy/crosschain.env -f deploy/compose.crosschain.yml up -d --build
docker compose --env-file deploy/crosschain.env -f deploy/compose.crosschain.yml logs --tail=100
```

Configure the HTTPS reverse proxy to forward paths unchanged to
`127.0.0.1:18890`. The browser origin must exactly match `BETTER_AUTH_URL`.
Verify sign-in, `/api/crosschain/health`, `/api/crosschain/vault`, both backend
mapping routes and `/api/crosschain/allocation`. The image's generic health check
is a liveness check; `npm run check:crosschain` is the financial-readiness check.

The local DB is for local accounts. The server starts a new isolated DB by default.
If local accounts must be preserved, use a consistent SQLite backup and copy it
to the volume while the new stand is stopped; do not copy a live WAL database file.
