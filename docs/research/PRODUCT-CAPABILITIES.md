# Product capabilities and UX acceptance criteria

Research date: 20 September 2026. Scope: the actual Individual workspace, its
local source and public data contracts. This is a code-based product/UX review,
not user-interview research. No customer wallets, private environment files,
databases or shared-preview transactions were used.

## What the product currently does

Thesauros provides the infrastructure for an Earn experience inside a financial
product. This workspace lets a prospective user inspect that infrastructure,
compare lending markets and experience a simulated deposit/withdrawal journey.
Those are three related but distinct activities.

| User task             | Available implementation                                                                                                 | Data/action boundary                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Sign in               | RainbowKit/wagmi wallet connection and SIWE session                                                                      | Ownership message; no token approval or transfer                                                        |
| See my funds          | WalletCard reads asset balance, vault shares and their asset value at one block                                          | Real read-only wallet data, first reported vault on connected network; not an all-chain portfolio       |
| Inspect Thesauros     | Vault rows, source timestamps, provider allocation, history, indexed lifetime activity and alerts                        | Monitor API via authenticated `/app/live?kind=protocol`; availability varies by network                 |
| Compare the ecosystem | Selected stablecoin markets, search, network/protocol filters, supply APY, reported pool TVL and historical observations | DeFiLlama external observations, not all available DeFi markets and not promised Thesauros integrations |
| Inspect activity      | Indexed protocol events and explorer links, event filter, CSV                                                            | Protocol-wide activity; not the connected wallet's transaction history                                  |
| Try Earn              | Explicitly add simulated 10,000 USDC; deposit, partial/full withdrawal; persistent balances and history                  | Server-side simulation, fixed model rate, no blockchain transaction                                     |
| Build an integration  | Documentation/SDK links, partner-contact entry                                                                           | Institution workspace and developer console remain Coming soon                                          |
| Manage access         | Verified wallet address, copy, logout; mismatch closes previous session                                                  | Current Individual account; no email login                                                              |

The older `PRODUCT-APP-ARCHITECTURE.md` is a historical design document. It
describes email-era demo access and an open Institution workspace. The active
`docs/ACCOUNT-WORKSPACES.md`, route gates and source are authoritative today.
`docs/MONITORING.md` also has a stale opening paragraph: `/monitoring` currently
shows the Institution gate instead of redirecting to the Individual Protocol tab.

## What a first visitor should understand in 30 seconds

1. **The offer:** Thesauros connects a financial product to lending infrastructure
   so its users can have an Earn balance.
2. **The three things I can do now:** inspect live vaults, compare observed
   markets, and try the end-user Earn flow with simulated USDC.
3. **What belongs to me:** only the connected-wallet balance and my Sandbox
   account. Protocol assets and external pool TVL do not belong to my account.
4. **The next action:** start the Sandbox, inspect a vault, or open integration
   documentation/contact. There is a visible, recoverable path for each.

For an investor, the strongest demonstration is a coherent functioning journey:
enter, understand the product, inspect sourced evidence, complete a simulated
deposit and withdrawal, then see how a partner would integrate. Fabricated scale
metrics or a decorative account balance would weaken that demonstration.

## Useful Overview metrics already supported by the source

| Metric / component       | Exact source                                                                | Presentation rule                                                                 |
| ------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Vaults observed          | `vaultRows(networks).length`                                                | Do not call them active; retained unavailable vault records exist                 |
| Reporting coverage       | Vault rows with finite `assets`; network `status`, `stale`                  | Distinguish current, retained and unavailable; show coverage near aggregates      |
| Networks monitored       | Networks with returned vault records                                        | Network selection applies; do not infer operational status from presence          |
| Markets compared         | Filtered `marketData().data.length`                                         | Label external/observed; the server selects a limited stablecoin universe         |
| Protocols represented    | Unique `market.name` in returned external data                              | These are market sources, not confirmed integrated vault providers                |
| Observed vault APY range | Finite `vault.apy` values                                                   | Same scoped vault universe; mark stale rates; no mixing model APY or external APY |
| Reported vault assets    | Existing `assetTotals(networks)`                                            | Separate token units; USDC and USDT0 are not a verified aggregate USD balance     |
| Provider allocation      | `vault.providers[].share`, `.balance`, `.apy`, `.name`                      | Show only returned values, label which vault/network; empty is unavailable        |
| Recent indexed activity  | `network.events[]`, events observation timestamp                            | Label protocol activity; do not present as customer traction or unique users      |
| Connected-wallet balance | `cash`, converted `earn`, `shares`, token, network/block/time in WalletCard | Connected network and first reported vault only; read-only                        |
| Sandbox progress         | `funded`, `account.events`, `principal`, `earnBalance`                      | Explicit simulated context; progress is derived from saved activity               |
| Sandbox model rate       | `netApy` from `/app/api`                                                    | Fixed model rate, not a live offer                                                |

Recommended compact proof strip: **Vaults observed / Markets compared /
Networks monitored**, with a source/coverage summary. For unavailable first
loads use a loading state or em dash, never a count of zero suggesting the
product has no data. Avoid a global green "Live" status when some sources failed.

## Priority usability gaps and acceptance criteria

| Priority | Finding                                                                                                               | Concrete acceptance criterion                                                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Live wallet, protocol reporting and simulated Earn appear in one space without a concise mental model                 | First screen and Quick guide name all three boundaries and offer working destinations; no real-wallet Deposit button opens a simulation without context                                           |
| P0       | New visitor has to interpret an empty Sandbox and find Add funds beside disabled actions                              | Initial state names the first action; funded/deposited/withdrawn states change guidance based on actual data; no false completion ticks                                                           |
| P0       | APY and external pool TVL can look like product promises                                                              | Model APY always labelled fixed/simulated; external data labelled as market observations; no aggregate external TVL labelled Thesauros capital                                                    |
| P1       | The large banner and four navigation cards push wallet/data below the first desktop viewport and very far down mobile | Retain marketing character, but make an operational summary and primary action visible early; mobile capability navigation is compact                                                             |
| P1       | There is no Quick guide to reopen after onboarding                                                                    | Persistent Quick guide entry; dismissible without a forced tour; concise sections for overview, live data, Sandbox and partner integration; touch/keyboard accessible                             |
| P1       | Generic Activity can mean personal history while showing protocol events                                              | Name the scope in navigation/title; keep Sandbox history within Sandbox and label it accordingly                                                                                                  |
| P1       | External network filter looks like it could control the wallet                                                        | Label filter as data scope; wallet explicitly shows connected network; scope changes must not imply wallet switching                                                                              |
| P1       | Vault detail opens below a potentially long table without focus/scroll management                                     | Opening a vault brings the detail heading into view and focuses it; closing returns focus to its row, matching Markets behavior                                                                   |
| P1       | Mobile tables are readable but require lateral scrolling to reveal rates/actions                                      | Preserve essential asset, network, rate and action together on narrow screens through mobile cards or a compact mobile summary; detailed tables remain accessible                                 |
| P1       | Chart has a fixed 770 px viewport, causing a separate horizontal gesture on phones                                    | Prefer a compact mobile plot/summary while retaining range input and exact observation values; no page-wide overflow                                                                              |
| P1       | Observed network and wallet-supported network universes differ                                                        | Do not imply that every observed network is available in the connection selector; wallet UI currently configures Arbitrum, Base and Ethereum, while wallet error text also names Plasma and Monad |
| P2       | Wallet refresh currently reports only the first vault in a network                                                    | Name the asset/vault boundary or add an explicit selection before calling this an entire portfolio                                                                                                |
| P2       | Balance reading reruns on monitor refresh and clears previous balance                                                 | Preserve last received data during refresh with loading state to avoid balance flicker; never confuse failed read with zero                                                                       |
| P2       | Unknown, empty, stale and filtered-out can feel identical                                                             | Test and distinguish all four states; refresh/retry/reselect must be available in context                                                                                                         |
| P2       | Vault and market counts can imply complete coverage                                                                   | Use observed/reported counts and source timestamps; server market sampling is not the entire ecosystem                                                                                            |

## Recommended quick guide

Use one lightweight panel with four concise sections rather than a forced
tooltip tour that depends on desktop element positions.

- **Understand Earn:** your app owns the customer experience; Thesauros connects
  it to lending infrastructure.
- **Explore the live layer:** inspect vault balances, rates, allocations and
  protocol activity; compare separate external market observations.
- **Try the account:** add simulated funds, deposit, then withdraw; nothing
  moves from the connected wallet.
- **Build with it:** integration guides/SDKs and contact; Institution access is
  still Coming soon.

Each section has one matching action. The guide closes on Escape, traps and
restores focus if modal, fits a 320 px screen, and can be reopened. Completion
or dismissal is not presented as completion of a financial action.

## Functional QA acceptance matrix

- **Navigation:** first-entry defaults, all six sections, hash/back/reload,
  reopening guide, mobile Menu open/close/Escape/focus restore, direct links.
- **Live data:** loaded, partial, stale, no source, zero versus null, network
  all/subset/none, exported scope, source timestamps, no invented metrics.
- **Vaults/markets:** detail open/close focus, filtering that removes selection,
  no history until requested, empty history and retry, all rows reachable.
- **Sandbox:** unfunded first action; funding once; amount validation; deposit;
  withdrawal; no duplicate on repeated submit; failure preserves amount and
  retry; refresh cannot overwrite a completed operation; reload persistence;
  progress derived from server state. All transaction tests use an isolated DB.
- **Wallet:** cancelled connection/signature, retry, read error, unsupported
  chain, chain change, account mismatch logout, no approval/transaction RPC.
- **Responsive/accessibility:** 320/390/768/1440 widths, no page overflow,
  200% zoom/reflow, minimum 16 px amount input on mobile, usable touch targets,
  contrast, visible focus, reduced motion, loading/error announcement.
- **Performance:** no new video/dependency for the app shell; lazy developer
  tools and Sandbox preserved; production build and route checks pass.

## Source files inspected

`ProductApp.jsx`, `WorkspaceIntro.jsx`, `LivePanels.jsx`, `WalletCard.jsx`,
`TestAccount.jsx`, `AccountSettings.jsx`, wallet provider/session guard,
`app/app/api/route.js`, `app/app/live/route.js`, `lib/live-data.mjs`,
`lib/product-ledger.mjs`, `lib/workspace-view.mjs`, README and product/account/
monitoring docs. Public fixtures establish field shapes, not current metrics.

## Sandbox implementation and validation

Implemented in `TestAccount.jsx` with an isolated `sandbox.module.css`:

- A three-step checklist derives completion from persisted funding and actual
  deposit/withdrawal events. No completion state is fabricated in the browser.
- The primary action follows the current task: add funds, deposit, withdraw.
  Mobile presents that action before the balance card, with a compact progress
  strip; desktop places balances and actions in one account panel.
- The balance card separates Earn, available funds and accrued yield. The
  fixed model rate and simulated context remain visible.
- Contextual empty state explains where activity will appear. Error retry,
  deposit/withdrawal confirmation, validation, idempotency and the existing
  in-flight GET cancellation behavior are preserved.

The isolated audit server at `127.0.0.1:18882` passed 25 browser checks covering
funding, valid/invalid deposit, controlled failed request and retry, partial/full
withdrawal, step progression, persistence, CSV, focus trapping/restoration and
320/390 px reflow. A fresh ephemeral SIWE wallet was used; only the isolated
test ledger changed. No real-wallet or shared-preview transactions were sent.
Desktop and mobile screenshots are saved beside the repository at
`work/evidence/workspace-research-20260920/`. Parent-agent integration owns the
production build and final shared-preview rollout.
