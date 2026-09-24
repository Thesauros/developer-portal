# Previous workspace iteration: research and design decisions

**Superseded by the [Earn product reset](PRODUCT-RESET-20260920.md), [visual system](PRODUCT-VISUAL-RESET.md), and [real contract integration review](CONTRACT-INTEGRATION-20260920.md).** The notes below document the earlier read-only workspace.

20 September 2026. This iteration combines three independent specialist reviews
with an implementation and browser review of the existing product.

## The decision

Present the workspace as a useful product experience: understand Thesauros,
inspect its infrastructure, try Earn, then find an integration path. Retain the
brand character without placing a catalogue of promotional cards before the
account. Make the boundaries between wallet balances, protocol observations,
external markets and simulated funds clear at the point of use.

The intended first-session outcome is concrete: a visitor can explain what
Thesauros provides, inspect an allocation, complete a simulated deposit and
withdrawal, and find the documentation or team contact.

## Research evidence

- [UX strategy and competitor comparison](UX-STRATEGY.md): Opal, Veda and Morpho;
  Individual, integration-partner and investor jobs; first-session journey.
- [Visual direction](VISUAL-DIRECTION.md): Mercury, Stripe and Morpho reference
  patterns; visual hierarchy, component system and mobile composition.
- [Product capability audit](PRODUCT-CAPABILITIES.md): actual APIs, wallet reads,
  simulation, available metrics, product limitations and acceptance criteria.

Sources are linked within each review. These are public-site benchmarks,
source inspection and expert evaluation, not interviews or measured conversion
research. Competitors' authenticated products were not comprehensively tested.
No competitor design, scale metric or security claim was copied into the app.

## Decisions implemented

| Finding                                        | Implementation                                                                         | Intended outcome                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Product proposition is implicit                | Compact reflections banner with app / vault / lending-market diagram                   | Explain the B2B value before technical detail             |
| Banner and four promo cards hide the account   | Wallet follows the banner; compact first steps sit beside it on desktop                | Reveal personal context much earlier                      |
| First visit has no orientation                 | Reopenable four-step Quick guide, accessible from the header and Overview              | Explain the system without a compulsory tour              |
| Live and simulated actions are easy to confuse | Explicit Sandbox entry, separate observed-data section, connected-network wallet scope | Match expectations to actual actions                      |
| Test account starts with disabled actions      | Contextual funding/deposit/withdrawal guidance driven by saved activity                | Make the first useful action obvious                      |
| Navigation gives every item the same weight    | Workspace / Explore onchain / Manage groups; mobile dock                               | Make product tasks easier to scan and reach               |
| Mobile tables hide the rate and action         | Dedicated vault and market cards on narrow screens                                     | Keep asset, network, rate and next action together        |
| Vault detail can open below the viewport       | Scroll/focus detail and return focus to its originating row/card on close              | Make drilldowns usable on phones and with a keyboard      |
| Charts require a sideways gesture              | Plot dimensions follow the container; exact observation slider retained                | Keep the chart and labels legible on phones               |
| External TVL is called liquidity               | Pool TVL labels and a short definition                                                 | Distinguish supplied capital from withdrawal availability |
| Commercial story disappears inside the account | Partner banner, integration step, documentation and contact links                      | Connect the working demo to a partner conversation        |

## The demonstration route

1. Sign in with a wallet and open Overview.
2. Open Quick guide; explain the app / vault / market relationship.
3. Open Vaults, select an allocation and inspect its reported data and source.
4. Open Sandbox, add test USDC, deposit and withdraw. Observe balances, saved
   transaction history and actual completion states.
5. Use the integration entry or Talk to Thesauros to continue the partner journey.

On mobile the persistent dock provides Overview, Vaults and Sandbox. Markets,
Activity and Account remain in Menu. The same guide is available in the header.

## Product boundaries preserved

Wallet sign-in remains SIWE. Wallet positions are read-only and limited to the
configured vault on the connected network. Sandbox deposits and withdrawals
remain server-side simulations, with their fixed model rate labelled. Institution
remains Coming soon. The partner API, contracts, authorization and ledger schema
are not changed by this redesign.

Live observations may be retained or unavailable when the upstream monitor/RPC
fails; timestamps and partial-data states are retained. Observed counts are not
represented as customer adoption, TVL or a complete index of DeFi.

## Validation and release

Evidence and verification scripts are stored outside this checkout in
`work/evidence/workspace-research-20260920/`. The final production build passes,
as do 90 browser checks, 82 native-route HTTP checks and 16 selection/reporting
checks. Dedicated guide and Sandbox reviews add short-viewport, recovery and
completion-state coverage. Desktop/mobile screenshots were visually inspected.
All financial
simulation testing uses the isolated audit database; shared-preview verification
contains only authentication and read-only navigation.

This is a local review release. No GitHub push or PR is authorized by the request.
The shared preview runs `.next-release-workspace-20260920`, with its existing
authentication environment and account database preserved.

Browser coverage uses Chromium at 320, 390, 768 and 1440 px, including short
guide viewports. The environment lacks the native libraries required for WebKit;
physical iPhone/wallet handoff and moderated user testing are not claimed.
