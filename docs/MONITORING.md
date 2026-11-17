# Protocol and market views

The vault's capital, exposure and moves are on the Transparency page. The
benchmark is on the Market Average page. Both are open without sign-in.
`/monitoring/` is an entry alias: it asks for Institution sign-in and then opens
Transparency. The separate monitor UI has been retired.

The Market Average page (`app/app/book/IndexPage.jsx`) replaced the old live panels. `lib/live-data.mjs` normalizes
public monitor responses from `monitoring.thesauros.io` (formerly
`bastardgreeks.thesauros.io`). Market rates come from the Thesauros indexer
(`lib/market-history.mjs`), not from an outside service. `app/app/live/route.js` gates access through
the account session. `app/monitoring/data/route.js` is a compatibility feed.

Missing balances/rates stay null. Cached responses keep their original source
and observation time and are marked stale after a refresh failure. The UI does
not invent historical rates. External market liquidity is not Thesauros TVL.

Run `npm test` for fixture normalization, source scope and cache behavior.
See [account operation](ACCOUNT-WORKSPACES.md) for source units, retention and
wallet boundaries, and [deployment](DEPLOYMENT.md) for the native public routes.
The original monitor backend is a separate service and is not included here.
