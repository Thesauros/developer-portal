# Individual and Institution account application

The same Next.js app serves both roles. Its internal pages are `/customer` and
`/customer/:mode`; the public proxy exposes `/app/`, `/app/individual` and
`/app/institution`. Authentication determines the role, not the requested URL.

Both roles include protocol/market views, a persistent test account, activity
and settings. Institution adds company reporting and embedded developer tools:
Quickstart, API explorer, keys, webhooks, usage, reconciliation and test customers.
Customer reporting stays empty until an actual partner integration is connected.

## Account state

Better Auth and SQLite persist accounts, sessions, recovery hashes and per-user
workspaces across reloads and restarts. New accounts start empty. Each user can
explicitly receive test funds once. Test deposits and withdrawals use the
account-scoped ledger; request IDs make repeated writes idempotent. These are
simulated operations, not onchain transactions. Legacy seeded workspaces remain
available to ledger tests but are not used to seed a new signed-up account.

`lib/product-ledger.mjs` keeps cash and Earn lots, accrual and transaction history.
The simulation's configured allocation and rate are separate from the observed
protocol/market data. Read-only wallet access does not authorize money transfers.

## Integration boundary

The embedded developer tools use the separate shared API sandbox under
`/api/v1`. Its customers and credentials are test data, separate from account
balances. The NestJS Partner API and client SDKs live in
`Thesauros/developer.thesauros.io`. Signing up here does not automatically
provision or authorize a real company integration.

See [account operation](ACCOUNT-WORKSPACES.md) for auth, recovery, source data and
current verification limitations, and [deployment](DEPLOYMENT.md) for setup.
`npm test` covers ledger invariants, source normalization/cache and encryption.
Points and referrals are absent from the product UI.
