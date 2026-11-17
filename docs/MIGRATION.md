# Moving from a previous USDC vault

Confirmed on 2026-11-12 against the running app configuration, deployment
artifacts and live RPC bytecode/asset/decimals checks. The user confirmed the
destination EpochVault and specified that users transfer Arbitrum proceeds to
Base themselves.

| Previous vault   | Chain | Previous vault proxy                         | Native USDC                                  |
| ---------------- | ----- | -------------------------------------------- | -------------------------------------------- |
| USDC on Arbitrum | 42161 | `0x4E5c0A4C11d713002D74bA43a458efc31bc76378` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| USDC on Base     | 8453  | `0x3C7739173cca612B6394EE57131458185A5beC44` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

The previous vaults on Monad, Plasma and Ethereum are withdraw-only. The app's
Move page lets their holders withdraw; there is no move from them.

Both previous vaults map to Base EpochVault
`0x33c4F5Efc49DCEa72bfA8Fe62e5Cb7B3226d7cB6`. Approval spender and deposit target
are this proxy. The Base and Arbitrum strategy contracts are internal allocation
targets and never receive user approvals. All assets and shares have 6 decimals.

Sources: `lib/vault-contracts.mjs`, `lib/crosschain-config.mjs`,
`docs/research/CONTRACT-INTEGRATION-20260920.md`, and
`optimized-rebalancer-contracts/deployments/{base,arbitrum}/crosschain.json`.
Historical proxies from the earlier app generation are outside this mapping.

## In the app

The move is its own screen at `/app/individual/move`. A wallet that holds a
position in a previous vault sees a notice at the top of every page, and the
notice opens that screen. A bridge fee, or a remainder below the minimum
deposit, does not keep a move open: the holder can finish with what arrived.

A balance above the per-batch deposit limit moves in parts. The screen says how
many batches it needs before anything is withdrawn and proposes to take out only
what the open batch has room for (`prepareTransaction` with `amount`), so the
rest keeps earning in the previous vault. The holder can stop at the deposit
step and keep what was withdrawn (`thesauros.move.kept.v1.<owner>` in
localStorage, passed to `deriveMigration` as `kept`), and resume later. A
deposit request can be cancelled from the screen until its batch settles. In
another browser the journal is empty: `importWithdrawal(vaultId, hash)` verifies
a withdrawal on chain and adds it to the journal there.

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

Connected wallet changes reset all views. Each previous vault is checked
independently; RPC failure is an unknown position. Nonzero shares retain the old
product. Verified zero shares hide the migration panel, including historical
completion cards. Undeposited wallet funds can be deposited through the new
vault's form; its Max button uses the full available balance. Existing epoch
requests and claims continue in the new vault's request list. Verified migration
request IDs are merged into that list while indexing catches up. An unresolved
signing intent retains its original recovery and same-nonce retry controls in a
compact pending-transaction section of the new vault.

Wallet-scoped browser storage keeps hashes and exact signing intents, not trusted
financial completion flags. Receipts, token transfers and request states are
rechecked from chain after reload and confirmation. Cancelled new requests restore
the outstanding migration amount. Partial deposits leave the remainder available;
bridge fees must be covered or the remainder stays unfinished.

The migration amount and Base wallet balance are separate. Max selects the full
verified Base USDC balance; a deposit may include additional wallet funds. The
review shows this breakdown, and migration credit is capped at confirmed legacy
withdrawal proceeds. A small legacy balance can be topped up to the live minimum
deposit. Other previous vaults are tracked separately and cannot reuse the same
deposit receipt. Ordinary new-vault actions remain available independently of
legacy balances, with shared pending-operation and wallet-lock protection.

Every signing request has a persisted reserved nonce and runs under a wallet-wide
lock (`lib/wallet-lock.mjs`): a Web Lock where the browser offers one, and a
renewed lease in browser storage where it does not (Web Locks exist only on a
secure origin, so a preview served over plain HTTP uses the lease). A reload
during signing can retry exactly the same operation with that nonce, after fresh
checks. Confirmed same-nonce replacements/cancellations can be recovered by
hash. Unknown results never trigger a new nonce automatically. Durable browser
storage is required to sign safely.
Clearing browser storage or moving to another browser does not preserve local
signing intents; retain explorer links. No funds are stored by the app.

Private RPC endpoints are runtime-only. Browser reads use an authenticated,
bounded, read-only RPC proxy; public RPCs remain fallbacks. No private URL is
included in client assets or provider error responses.

## Checks and release

Run `npm test`, `npm run build`, `npm run test:routes`,
`npm run check:migration`, and `npm run check:crosschain` with Node.js 22.
The migration suite covers zero/multiple/partial positions, exact units,
withdrawn-but-not-deposited balances, clearing/claim, cancellation, wrong
wallet/network, RPC failures, signature rejection and same-nonce retries.
Live checks are read-only and require no funded wallet.

See `MIGRATION-DEPLOYMENT.md` for the exact `migration` branch release process,
production version endpoint, account preservation and event-index worker.

As of 12 November 2026: at preparation, the configured operator lacked native ETH in Base, leaving NAV
stale. New request guards must stay in place until the operator is funded and
the existing NAV/keeper loops restore accepted ticks and epoch clearing. No
operator funding or administrative contract transaction is part of this release.
