# Unified Thesauros workspaces

One app for Individual and Institution accounts. It has one live product, USDC Multichain: deposits and withdrawals are requests in USDC on Base that settle in batches, and the vault lends on Base and Arbitrum. Individual signs in with a wallet; Institution with a wallet or email. The API sandbox under Developers is simulated. The website is the public entry; `/app/` is the account entry.

## Routes and responsibilities

| Route                  | Destination                                                                      |
| ---------------------- | -------------------------------------------------------------------------------- |
| `/app/individual`      | Portfolio, Earn, Activity, Transparency, Market Average, Developers and Account  |
| `/app/individual/move` | The move from a previous vault                                                   |
| `/app/institution`     | The same sections for a treasury wallet, after sign-in                           |
| `/developers`          | Redirects to `/app/institution`                                                  |
| `/monitoring`          | Institution sign-in, then Transparency                                           |
| `/api/v1/…`            | The API sandbox and its SDK contract                                             |

The sections under `/app/individual` are `/earn`, `/activity`, `/transparency`, `/market-average`, `/developers`, `/account` and `/move`; Portfolio is the root. They can be read without a wallet. Connecting is needed only to see a balance or to act.

Individual uses wallet connection and Sign-In with Ethereum. Institution signs in with a wallet or with email and password. The view choice does not grant access to legacy company accounts. See [account setup and operation](docs/ACCOUNT-WORKSPACES.md).

## Published economics

The planned fee is 25% of yield and nothing on principal. No fee is charged on chain today. Under the [Tokenomics Blueprint](https://tokenomics.thesauros.io/#s3), partners keep 30% of that fee as standard, up to 50% before the token launch and for 60 days after it, and up to 80% through bonding. The partner share applies to the fee once it is charged.

The Quickstart view states the same terms, and the sandbox partner seeds in `lib/api/store.js` carry `revenue_share_pct` 0.3 and 0.8 so sample data does not contradict the published deal.

## Local development and deployment

The app runs on the USDC Multichain vault (the cross-chain contracts) by default.
Local run: `npm run crosschain:local -- --build` with Node.js 22 and dependencies
installed. It starts the app and the event indexer for requests, claims,
cancellations and valuations. See [docs/CROSSCHAIN-STAND.md](docs/CROSSCHAIN-STAND.md).

Deposits follow the contract and are open unless the build sets
`NEXT_PUBLIC_THESAUROS_DEPOSITS=closed`. Withdrawing, collecting and cancelling
work either way. The older flags `NEXT_PUBLIC_THESAUROS_PRODUCT` and
`NEXT_PUBLIC_THESAUROS_BATCH_DEPOSITS` no longer exist.

This directory has its own `package.json` and lockfile. Run `npm ci` from the repository root, then
follow [setup and routing](docs/DEPLOYMENT.md) to configure the account database,
initialize auth, build Next.js and open `/app/individual` directly. No URL rewrite is required. The NestJS backend and SDKs live separately in `Thesauros/developer.thesauros.io`.

## Active source

- `app/app/ProductApp.jsx` and `app/app/wallet/`: the shell, the menu and the wallet session
  for both account types. Product and design context: [docs/PRODUCT.md](docs/PRODUCT.md) and
  [docs/DESIGN.md](docs/DESIGN.md).
- `app/app/book/`: the pages. `PortfolioPage.jsx`, `VaultPage.jsx` (Earn), `ActivityPage.jsx`,
  `TransparencyPage.jsx` and `IndexPage.jsx` (Market Average), with `ActionPanel.jsx` and
  `useBatchVault.js` for deposit and withdrawal requests, claims and cancellations.
- `app/app/move/` and `useMigrationAccount.js`: the move from a previous vault.
  `lib/migration-*.mjs` holds its state, receipts and retries. See [docs/MIGRATION.md](docs/MIGRATION.md).
- `lib/crosschain-*.mjs`: the vault's pinned addresses, contract verification, reads,
  transactions, event history and feeds. `scripts/index-crosschain.mjs` is the event indexer.
- `lib/vault-book.mjs` and `lib/vault-facts.mjs`: one model of the vault and the previous
  vaults for every screen, and the facts shown beside the numbers.
- `lib/market-index.mjs` and `lib/blue-chip-index.mjs`: the Market Average, from daily
  readings of each market.
- `lib/vault-contracts.mjs`, `vault-reads.mjs`, `vault-transactions.mjs`: pinned deployment
  and implementation checks, reads and transactions for the previous vaults.
- `useEarnAccount.js`, `app/app/onchain/route.js`: authenticated, independent network reads
  and receipt recovery.
- `QuickGuide.jsx` and `vault-guide.js`: the "How it works" guide.
- `Login.jsx`, `InstitutionLogin.jsx`, `EntryRedirect.jsx`, `destination.mjs`: sign-in and
  trusted destination mapping.
- `DeveloperCenter.jsx`, `DeveloperTools.jsx` and the eight `app/views/` components: the
  Developers page and the API Sandbox.
- `StrategyLab.jsx`, `lib/api/strategy.js`, `lib/api/market-paths.js`: the Strategy Lab, a
  parameterized backtester for routing policies, its baselines, and the paired A/B experiment
  that turns a hypothesis into a verdict. It is a tab of the API Sandbox, reached from its
  tab rather than by URL. See [Strategy Lab](docs/STRATEGY-LAB.md).
- `app/api/v1/` and `lib/api/`: existing sandbox handlers and resource contracts.

Developer tools, Sandbox and account settings load when opened. External market and indexed protocol requests start only on their respective pages.

Accounts persist in the private SQLite or configured Turso database. The separate API sandbox retains shared sample data; it does not represent connected company customers. Sandbox webhook tests never send network requests: reserved example receivers simulate success, and other receivers record a blocked delivery with zero attempts. Real webhook delivery belongs to the separately authenticated partner API. Current company reporting remains empty until a partner integration is connected.

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
account access, live data views and embedded integration tools. The web app previously submitted in backend PR #12 is being
removed from that repository in a companion PR.

The NestJS/PostgreSQL Partner API and TypeScript/Python SDKs remain in
`Thesauros/developer.thesauros.io`. The built-in API sandbox here is part of the
portal and has a separate contract; it is not the Partner API backend.

Marketing is in `Thesauros/thesauros.io` and documentation in
`Thesauros/docs.thesauros.io`. Each project builds and deploys separately.
Opening or merging a PR does not restart the shared preview server. The separate economics studio at `/demo/` is not
included here.

## Real contract integration

The wallet, not the server, signs all financial operations. Deposits go to the
USDC Multichain vault on Base, `0x33c4F5Efc49DCEa72bfA8Fe62e5Cb7B3226d7cB6`. The
single-network vaults on Arbitrum and Base are previous vaults and are used only to
withdraw and move. In the live vault a deposit is approve, request and claim, and a
withdrawal is request and claim. Requests settle in batches. The contracts behind the
live vault have had no external audit yet.

Addresses, source verification and contract semantics of the previous vaults are
documented in [the contract review](docs/research/CONTRACT-INTEGRATION-20260920.md).
An unexpected implementation upgrade blocks actions until the new runtime is reviewed.

The rest of this paragraph describes the previous vaults' one-transaction flow.
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
