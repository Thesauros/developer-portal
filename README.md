# Unified Thesauros workspaces

One account application with Individual and Institution roles, persistent test deposits, live protocol and market views, and embedded developer tools. The website is the public entry; `/app/` is the account entry.

## Routes and responsibilities

| Route | Destination |
| --- | --- |
| `/app/individual` | Personal workspace: protocol, markets, wallet reads, test account and account settings |
| `/app/institution` | Business workspace: the same views, plus reporting, customer integration and developer tools |
| `/developers/` | Compatible entry into Institution developer tools |
| `/monitoring/` | Compatible entry into the signed-in account’s protocol statistics |
| `/developers/api/v1/…` | Existing integration sandbox and SDK contract |

Role and destination survive login and registration. A requested URL never grants a different account role. See [account setup and operation](docs/ACCOUNT-WORKSPACES.md) for authentication, data sources and deployment settings.

## Local development and deployment

This directory has its own `package.json` and lockfile. Run `npm ci` from the repository root, then
follow [setup and routing](docs/DEPLOYMENT.md) to configure the account database,
initialize auth, build Next.js and connect the `/app/` reverse proxy. The NestJS backend and SDKs live separately in `Thesauros/developer.thesauros.io`.

## Active source

- `app/customer/ProductApp.jsx` and `workspace.module.css`: role-aware shell and account navigation.
- `Login.jsx`, `EntryRedirect.jsx`, `destination.mjs`: sign-in, recovery and trusted destination mapping.
- `LivePanels.jsx`, `WalletCard.jsx`, `lib/live-data.mjs`: protocol, external markets and read-only wallet balances.
- `TestAccount.jsx`, `lib/product-ledger.mjs`: persistent test balances and idempotent simulated deposits/withdrawals.
- `DeveloperTools.jsx` and the seven `app/views/` components: the Institution integration sandbox.
- `app/api/v1/` and `lib/api/`: existing sandbox handlers and resource contracts.

Developer tools, the test account and account settings load when opened. The Individual overview does not download the API explorer and developer screens.

Accounts and test transactions persist in the private SQLite database. The separate API sandbox retains shared sample data and its original contract; it does not represent connected company customers. Test webhook controls send requests only to the receiver configured by the user. Current company reporting remains empty until a partner integration is connected.

## Verification

Run `npm test` for ledger invariants, data normalization and source-cache behavior.
The public data fixtures are included under `test/fixtures/live-data`; tests do
not require the original preview workspace. Run `npm run build` after configuring
and initializing auth as described in the deployment guide.

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

Marketing is in `573pn01v01k/thesauros-site` and documentation in
`Thesauros/docs.thesauros.io`. Each project builds and deploys separately.
The running preview remains in its original local workspace; opening or merging
these PRs does not deploy it. The separate economics studio at `/demo/` is not
included here.
