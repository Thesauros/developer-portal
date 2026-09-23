# Unified Thesauros workspaces

Individual uses wallet sign-in and real USDC Earn deposits/withdrawals on Arbitrum and Base, alongside a separate simulated Sandbox and market research. Institution also uses wallet sign-in to access the current workspace. The website is the public entry; `/app/` is the account entry.

## Routes and responsibilities

| Route              | Destination                                                                            |
| ------------------ | -------------------------------------------------------------------------------------- |
| `/app/individual`  | Earn, personal receipts, verified vaults, market research, Build, Sandbox and settings |
| `/app/institution` | Wallet access to the current workspace and integration resources                       |
| `/developers/`     | Institution wallet entry                                                               |
| `/monitoring/`     | Institution wallet entry                                                               |
| `/api/v1/…`        | Existing integration sandbox and SDK contract                                          |

Individual and Institution use wallet connection and Sign-In with Ethereum. The view choice does not grant access to legacy company accounts; both use the same authenticated wallet and personal Sandbox. See [account setup and operation](docs/ACCOUNT-WORKSPACES.md).

## Published economics

Thesauros charges a 25% performance fee on the yield generated and nothing on the principal — if a period earns nothing, no fee is charged. Partners keep 50% of that fee as standard, and up to 80% in specific cases: 12.5% to 20% of all yield generated.

The Quickstart view states the same terms, and the sandbox partner seeds in `lib/api/store.js` carry `revenue_share_pct` 0.5 and 0.8 so sample data does not contradict the published deal.

## Local development and deployment

This directory has its own `package.json` and lockfile. Run `npm ci` from the repository root, then
follow [setup and routing](docs/DEPLOYMENT.md) to configure the account database,
initialize auth, build Next.js and open `/app/individual` directly. No URL rewrite is required. The NestJS backend and SDKs live separately in `Thesauros/developer.thesauros.io`.

## Active source

- `app/app/ProductApp.jsx` and `workspace.module.css`: role-aware shell and account navigation.
- `EarnWorkspace.jsx`, `VaultExplorer.jsx`, `product.module.css`: operational Earn account,
  verified vault comparison, transaction review and receipt states.
- `QuickGuide.jsx`, `IntegrationHome.jsx`: practical onboarding and the partner integration path.
  The active design specification is [the product reset](docs/research/PRODUCT-RESET-20260920.md).
- `Login.jsx`, `EntryRedirect.jsx`, `destination.mjs`: wallet sign-in and trusted destination mapping.
- `useEarnAccount.js`, `app/app/onchain/route.js`: authenticated, independent network reads and receipt recovery.
- `lib/vault-contracts.mjs`, `vault-reads.mjs`, `vault-transactions.mjs`: pinned deployment/implementation checks,
  exact-amount approval, fresh previews, simulation, wallet execution and confirmed receipts.
- `LivePanels.jsx`, `lib/live-data.mjs`: external market research and explicitly indexed protocol activity.
- `TestAccount.jsx`, `lib/product-ledger.mjs`: persistent test balances and idempotent simulated deposits/withdrawals.
- `DeveloperTools.jsx` and the seven `app/views/` components: the Institution integration sandbox.
- `app/api/v1/` and `lib/api/`: existing sandbox handlers and resource contracts.

Developer tools, Sandbox and account settings load when opened. External market and indexed protocol requests start only on their respective pages.

Accounts and test transactions persist in the private SQLite or configured Turso database. The separate API sandbox retains shared sample data and its original contract; it does not represent connected company customers. Test webhook controls send requests only to the receiver configured by the user. Current company reporting remains empty until a partner integration is connected.

## Verification

Run `npm test` for transaction orchestration, receipt identity, history recovery, ledger invariants, data normalization, source-cache behavior and wallet authentication.
The public data fixtures are included under `test/fixtures/live-data`; tests do
not require the original preview workspace. Run `npm run build` after configuring
and initializing auth as described in the deployment guide, then run `npm run test:routes`
to check native routes, assets and wallet sessions on the compiled server.

The shared preview also has browser journey and public-route checks maintained
beside the marketing server. Those deployment-specific scripts and private test
accounts are not part of this source snapshot. CI in the repository root checks
this app alongside the dependency audit and static analysis.

## Repository separation

This PR brings the current Individual and Institution application into
`Thesauros/developer-portal`. It includes the latest clean marketing links,
account access, persistent test deposits, live data views and embedded
integration tools. The web app previously submitted in backend PR #12 is being
removed from that repository in a companion PR.

The NestJS/PostgreSQL Partner API and TypeScript/Python SDKs remain in
`Thesauros/developer.thesauros.io`. The built-in API sandbox here is part of the
portal and has a separate contract; it is not the Partner API backend.

Marketing is in `Thesauros/thesauros.io` and documentation in
`Thesauros/docs.thesauros.io`. Each project builds and deploys separately.
Opening or merging a PR does not restart the shared preview server. The separate economics studio at `/demo/` is not
included here.

## Real contract integration

The wallet, not the server, signs all financial operations. Deposits use the current
USDC vault deployments on Arbitrum and Base. Addresses, source verification and
important contract semantics are documented in [the contract review](docs/research/CONTRACT-INTEGRATION-20260920.md).
An unexpected implementation upgrade blocks actions until the new runtime is reviewed.

Approval grants exactly the entered amount and never automatically deposits. Both
action types require fresh state, a successful simulation and a matching successful
receipt. Full withdrawals redeem exact shares. Gross provider APR is distinguished
from APY and vault fees. The contracts do not offer a minimum-output parameter; the
review therefore describes share previews as estimates. Withdrawal availability
depends on pause state and liquidity.

Personal transaction history is stored in this browser per wallet; it is not a
complete chain index. Receipt links and account explorer links provide verification.
Unknown submission status remains blocked until checked; outstanding hashes survive
reload and are reconciled through an authenticated, allowlisted read-only endpoint.
The legacy MetaMask-warning investigation is not a clearance claim for these deployments.

This iteration is deployed to the local review service only. No GitHub publication
is implied by the local changes.
