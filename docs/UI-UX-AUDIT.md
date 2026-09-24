# Platform UI/UX audit — 20 September 2026

Status: findings remediated and deployed to the local review preview on 20 September 2026.

Release instruction, 20 September: deploy the revised application to the local
preview first for user review. Do not push or open a PR without a separate user
request. The current work is local only.

## Scope and source of truth

The new account application is in `Thesauros/developer-portal`, branch `v2`,
baseline `e3a23c4`. The local public preview serves this application at
`http://80.241.220.22:8878/app/individual`. Institution access remains a
Coming soon page, as previously requested; this audit does not unlock it.

On 20 September, `app-v2.thesauros.io` redirected to `app.thesauros.io`, which
served the separate legacy product, including Points Program. The developer
portal's `master` branch is a different application again. A clarification of
the intended public deployment was requested. Work here is isolated from both
production applications and from the real account database.

Review covers sign-in, overview, vaults/providers, markets, protocol activity,
the simulated deposit/withdrawal flow, account settings, Institution access,
responsive layouts, keyboard operation, and loading/error/empty/stale states.
Developer tools behind the existing Institution gate are reviewed as dormant
code, not represented as available production functionality.

## Findings and acceptance criteria

| ID    | Finding                                                                                                                                     | Required result                                                                                                                                  | Status                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| UX-01 | Navigation labels, breadcrumb, eyebrow, poetic headline and explanatory text repeat the same context.                                       | One functional page title; remove repeated context and promotional copy from the workspace.                                                      | Fixed; verified               |
| UX-02 | `Protocol` defaults to Base and displays only one network. Overview and activity use different scopes.                                      | All networks by default, individual and multiple network selection, explicit selection scope, comparable vault rows, scoped activity and export. | Fixed; verified               |
| UX-03 | Data labels, tables and source timestamps use 8–11 px text with pale colours.                                                               | Readable typography, consistent hierarchy, strong contrast, usable controls and no page overflow on narrow screens.                              | Fixed; verified               |
| UX-04 | Overview needs product context as well as data; removing all promotion makes capabilities harder to discover.                               | Keep a concise Earn banner and partner CTA, with direct entry points to balances, vaults, markets, transactions and developer documentation.     | Updated following user review |
| UX-05 | Vault detail renders a long stack of provider, history and lifetime panels before allowing cross-network comparison.                        | Present a useful vault comparison first; make individual vault detail available on demand without losing the network context.                    | Fixed; verified               |
| UX-06 | Market history loads even in the overview; full Markets puts a selected market chart before the comparison table. Rows stop silently at 30. | Compare markets first, load details on selection, show results/counts accurately and make every filtered result reachable.                       | Fixed; verified               |
| UX-07 | Activity has an event-type filter but no independent network context; a failed source can resemble an empty account.                        | Preserve selected networks, distinguish no events from unavailable data, expose refresh and meaningful export.                                   | Fixed; verified               |
| UX-08 | Sandbox repeats Test/Simulation in almost every label and adds a large three-step tutorial plus fabricated allocation cards.                | One clear simulation context; concise balance/actions/activity; deposit and withdrawal remain explicitly simulated and persist correctly.        | Fixed; verified               |
| UX-09 | Settings consumes two panels to show an address and repeat wallet sign-in information.                                                      | Compact account details with reliable copy feedback and access to account actions.                                                               | Fixed; verified               |
| UX-10 | Sign-in shows several vague slogans and decorative blocks around the only required action.                                                  | Clear wallet sign-in task, concise signature explanation, working rejection/retry and mobile layout.                                             | Fixed; verified               |
| UX-11 | Navigation uses platform-dependent Unicode glyphs.                                                                                          | Consistent vector icons, clear selected state, visible keyboard focus and usable mobile navigation.                                              | Fixed; verified               |
| UX-12 | Stale, missing and partial data needs to remain distinguishable from real zero balances as the interface is simplified.                     | No invented financial metrics, no mixing token units, timestamps remain available, missing values remain distinct from zero.                     | Fixed; verified               |

## Verification plan

- Capture baseline and revised desktop/mobile screens for every available route.
- Test network selection: all, individual, subset, reset and changes in source
  availability. Validate visible vaults, events and exports against that scope.
- Verify real source responses, then controlled populated, empty, partial,
  stale and failed responses. Clearly identify replayed fixtures in evidence.
- Exercise sign-in, wallet mismatch protection, navigation/back/reload, copy,
  market filters/detail/history, CSV export and simulated deposit/withdrawal.
- Check 1440, 768, 390 and 320 px layouts, keyboard paths and touch targets;
  inspect text contrast and zoom/reflow. Do not infer platform-wide
  accessibility from one automated scan.
- Run the existing ledger, data, authentication and native route checks plus
  focused tests for new selection/aggregation behaviour, then a production build.
- Keep real user state and wallet transaction semantics unchanged. Financial
  simulation labels and actual source errors are useful information, not copy
  to remove for cosmetic reasons.

The baseline screenshots and text captures are in the adjacent work evidence
directory `evidence/platform-ux-20260920/before/`.

Accessibility references:
[text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
[target sizes](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html),
[reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## Result of the initial audit

- Six task-based sections replace the promotional workspace shell. Sign-in and
  Account now explain the required action directly. Institution stays gated.
- One network selection controls the vault comparison, external markets and
  protocol activity. All is the default; arbitrary subsets and an explicit
  empty selection work. Wallet balances are labelled separately because they
  read the wallet's connected chain.
- Vaults compare side by side in a table. Token totals remain separate and
  expose reporting coverage. Missing entire networks, unknown values, retained
  snapshots and source failures remain visible, including in CSV exports.
- Market history is requested only after selecting a market. Detail receives
  focus; closing it returns focus to the selected row. All filtered markets
  remain reachable. Activity has pagination and exports the complete filtered
  set, including rows beyond the first page.
- Sandbox has one persistent simulation notice, account balances, actions and
  transactions. The decorative allocation breakdown and tutorial are removed.
  Background refresh cannot overwrite a mutation with an older GET response.
- Navigation uses SVG icons. Body data is 14–15 px, secondary labels 12–13 px,
  headings 28–32 px. Mobile tables scroll within their container. Menu and
  transaction dialogs trap focus and restore it on close.
- Updated deployment health checks accept the new sign-in title and the
  previous title for rollback. No authentication schema or financial contract
  changes are part of this release.

## Validation evidence

Evidence is stored locally in `work/evidence/platform-ux-20260920/`, outside
this Git checkout. Baseline and revised screenshots cover the six sections,
sign-in, vault details, network menu, controlled wallet reads and partial data.
The browser scripts create unfunded ephemeral wallets; private keys and session
cookies are not included in their reports.

- Existing ledger, live-data, retained-cache and encryption tests pass.
  Authentication passes 34 checks each against SQLite and local libSQL.
- 16 additional selection, aggregation and CSV checks pass. They cover network
  subsets, future networks, missing balances versus zero, token units, degraded
  data, missing entire networks and spreadsheet-safe exports.
- Final production build passes. 82 HTTP checks run against that compiled
  server, with isolated authentication storage. Ten deployment tests pass.
- Chromium browser coverage: shared network scope and CSV, market search and
  protocol filters, detail loading, Sandbox fund/deposit/withdraw/validation,
  reload persistence, copy, keyboard focus, source failure and recovery,
  Institution gate, and 768/390/320 px reflow. Main desktop review is 1440 px.
- Supplementary browser cases use explicitly controlled responses: 75 events
  exercise pagination/export, 53 markets exercise the removed row cap, and an
  absent network exercises missing-data handling. These are verification
  fixtures, not live financial claims.
- Wallet UI checks use a controlled EIP-1193 provider and real SIWE verification:
  rejected signature, retry, underlying balance and share conversion, unsupported
  chain, recovery and wallet mismatch logout. No transaction/approval methods
  are sent. Physical mobile-wallet handoff was not tested in this audit.
- Eight principal text/background pairs measure 5.69:1–15.72:1. Visible data and
  controls in the inspected workspace are at least 12 px. This is targeted
  contrast/reflow/keyboard verification, not a full WCAG certification.

## Source and environment limitations

The current monitor sometimes returns degraded RPC snapshots or retained events.
The UI now distinguishes those states; this work does not repair the separate
monitor service. Some vaults have no rate history. External markets retain the
existing backend's selected stablecoin universe; removing the UI row cap does
not claim to index every DeFi market.

WebKit could not start in this environment because its native runtime libraries
(including libevent) are absent. Responsive checks here used Chromium; a Safari
or physical iPhone pass remains a useful follow-up during review.

The legacy public app and legacy developer console are separate deployments.
Their Points Program and old navigation were observed in the audit but are not
changed by this local v2 review release. Dormant developer view components and
APIs remain in the repository for future Institution work.

## Local review release

Active at `http://80.241.220.22:8878/app/individual`, from local branch
`feat/platform-ux`. No push or PR was made. The local service runs the compiled
`.next-release-workspace-20260920` artifact from `work/developer-portal-ux`.
The previous auth environment was copied unchanged, preserving the existing
account database and session secret. The previous release is available for
rollback; marketing and documentation still return HTTP 200 through the same
preview gateway.

## Follow-up: product discovery and visual character

Following the local review, the user asked for a more expressive workspace and
clearer discovery of the platform's capabilities. The earlier removal of all
marketing content was too aggressive.

The revision restores the illustrated partner banner with “Talk to Thesauros”.
Overview gains an Earn banner using the existing blue reflections image and two
working actions: try a deposit in Sandbox, or jump to wallet balances. Four
capability cards explain vault allocation, lending-market comparison, transaction
records/export and integration documentation, each with a direct destination.
The mock account card contains no invented balances or yield rates. Sandbox is
identified as simulated. This is a navigation and presentation revision; the
network filtering, readable tables and data-quality states from the audit remain.

The follow-up production build passes. Twenty browser checks pass against both
development and compiled servers, covering every new destination, balance focus,
the mobile menu and reflow at 320, 390, 768, 1280 and 1440 px. Evidence lives in
`work/evidence/platform-discovery-20260920/`. After activation, an authenticated
smoke check through the public preview verifies both banners, all four capability
entries, Vaults navigation and sign-out without ledger or chain transactions.
Temporary test servers are stopped. No push or PR was made.

## Research-led workspace revision

The subsequent full design review and implementation are documented in
[Workspace research](research/WORKSPACE-RESEARCH.md), with separate UX, visual
design and product-capability reviews. This supersedes the initial audit's
minimalist Overview and Sandbox presentation. The compiled release includes the
four-step Quick guide, compact brand banner, earlier wallet placement, contextual
Sandbox journey, mobile navigation and data cards, responsive charts and corrected
Pool TVL terminology. Filtering, exports, source states and wallet authentication
remain intact. Production verification passes 90 browser checks and 82 native-route
checks; further guide and Sandbox scenarios are recorded in the research evidence.
