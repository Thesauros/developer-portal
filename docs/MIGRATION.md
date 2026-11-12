# Legacy USDC migration

Confirmed on 2026-11-12 against the running app configuration, deployment
artifacts and live RPC bytecode/asset/decimals checks. The user confirmed the
destination EpochVault and specified that users transfer Arbitrum proceeds to
Base themselves.

| Product       | Chain | Legacy proxy                                 | Native USDC                                  |
| ------------- | ----- | -------------------------------------------- | -------------------------------------------- |
| Arbitrum USDC | 42161 | `0x4E5c0A4C11d713002D74bA43a458efc31bc76378` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Base USDC     | 8453  | `0x3C7739173cca612B6394EE57131458185A5beC44` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

Both products map to Base EpochVault
`0x33c4F5Efc49DCEa72bfA8Fe62e5Cb7B3226d7cB6`. Approval spender and deposit target
are this proxy. The Base and Arbitrum strategy contracts are internal allocation
targets and never receive user approvals. All assets and shares have 6 decimals.

Sources: `lib/vault-contracts.mjs`, `lib/crosschain-config.mjs`,
`docs/research/CONTRACT-INTEGRATION-20260920.md`, and
`optimized-rebalancer-contracts/deployments/{base,arbitrum}/crosschain.json`.
Historical proxies from the earlier app generation are outside this mapping.

## Contract sequence

The verified legacy implementation has no withdrawal request/claim queue. Full
exit uses fresh exact shares in `redeem(shares, wallet, wallet)`, independently
of `maxWithdraw`/`maxRedeem`, which intentionally return zero. Liquidity and pause
restrictions are checked by fresh reads and simulation. No amount is reconstructed
from a rounded display.

The app confirms both `Withdraw` and the native USDC `Transfer` into the wallet.
Arbitrum proceeds then require the user's independent transfer to the same wallet
in Base. The app checks actual Base native USDC balance, ETH, chain, contract
identity and allowance before the next signature. Existing Base cash may fund
the deposit: fungible tokens do not establish which external bridge supplied it.

Base operations are separate `approve(exactAmount)` → `requestDeposit` → epoch
clearing → `claim`. An approved or queued deposit is never reported as completed
migration. A fresh accepted NAV and matching backend identity are required for
new requests; claim and recovery remain independent of backend health.

## Recovery and visibility

Connected wallet changes reset all views. Each legacy product is checked
independently; RPC failure is an unknown position. Nonzero shares retain the old
product. Zero shares hide its card while a continuation card retains undeployed
proceeds or unclaimed requests.

Wallet-scoped browser storage keeps hashes and exact signing intents, not trusted
financial completion flags. Receipts, token transfers and request states are
rechecked from chain after reload and confirmation. Cancelled new requests restore
the outstanding migration amount. Partial deposits leave the remainder available;
bridge fees must be covered or the remainder stays unfinished.

Every signing request has a persisted reserved nonce and runs under a wallet-wide
Web Lock. A reload during signing can retry exactly the same operation with that
nonce, after fresh checks. Confirmed same-nonce replacements/cancellations can be
recovered by hash. Unknown results never trigger a new nonce automatically.
Modern Web Locks support and durable browser storage are required to sign safely.
Clearing browser storage or moving to another browser does not preserve local
signing intents; retain explorer links. No funds are stored by the app.

Private RPC endpoints are runtime-only. Browser reads use an authenticated,
bounded, read-only RPC proxy; public RPCs remain fallbacks. No private URL is
included in client assets or provider error responses.

## Checks and release

Run `npm test`, `npm run build`, `npm run test:routes`,
`npm run check:migration`, and `npm run check:crosschain` with Node 24.
The migration suite covers zero/multiple/partial positions, exact units,
withdrawn-but-not-deposited balances, clearing/claim, cancellation, wrong
wallet/network, RPC failures, signature rejection and same-nonce retries.
Live checks are read-only and require no funded wallet.

See `MIGRATION-DEPLOYMENT.md` for the exact `migration` branch release process,
production version endpoint, account preservation and event-index worker.

At preparation, the configured operator lacked native ETH in Base, leaving NAV
stale. New request guards must stay in place until the operator is funded and
the existing NAV/keeper loops restore accepted ticks and epoch clearing. No
operator funding or administrative contract transaction is part of this release.
