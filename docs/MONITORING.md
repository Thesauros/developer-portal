# Protocol and market views

Monitoring is embedded in both authenticated account roles. `/monitoring/` is
an entry alias to the account's Protocol screen; the separate monitor UI has
been retired. The account also has a Markets screen and read-only wallet data.

`app/customer/LivePanels.jsx` renders the views. `lib/live-data.mjs` normalizes
public monitor responses from `bastardgreeks.thesauros.io` and stablecoin pool
observations from DeFiLlama. `app/customer/live/route.js` gates access through
the account session. `app/monitoring/data/route.js` is a compatibility feed.

Missing balances/rates stay null. Cached responses keep their original source
and observation time and are marked stale after a refresh failure. The UI does
not invent historical rates. External market liquidity is not Thesauros TVL.

Run `npm test` for fixture normalization, source scope and cache behavior.
See [account operation](ACCOUNT-WORKSPACES.md) for source units, retention and
wallet boundaries, and [deployment](DEPLOYMENT.md) for the public proxy routes.
The original monitor backend is a separate service and is not included here.
