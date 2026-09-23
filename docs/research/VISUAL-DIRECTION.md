# Thesauros workspace — visual direction

Reviewed 20 September 2026. This is an expert visual and interaction review based on the current implementation, its desktop/mobile screenshots, and public competitor material. It is not a user study or a claim that the design has been validated with investors.

## What the existing screen communicates

The current design has a credible navy palette, a useful persistent navigation, readable tables, and an appropriate brand image. The problem is its sequence. At 1440 px the first screen is mostly promotion: a 352 px banner followed by four similarly weighted cards. The wallet starts at approximately 796 px. At 390 px those cards stack before the balance, making the visitor scroll through a catalogue before finding their account. The banner's decorative card repeats an abstract promise instead of explaining a product mechanism.

That is the main design correction: let a visitor understand the proposition, see their account context, and discover the next action in one coherent first section.

Evidence: `work/evidence/platform-discovery-20260920/first-screen-1440.png` and `overview-390.png` in the surrounding workspace.

## Competitor observations and the decisions they support

| Reference                                                                                                                                            | Observed public pattern                                                                                                                                                                                                                     | Apply to Thesauros                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Mercury Insights](https://mercury.com/insights)                                                                                                     | A financial picture is explained through a hierarchy of primary metrics, charts and drilldowns. The public product image places a useful metric and its context together.                                                                   | Make each block answer a question. Account balances answer “what is mine”; vaults answer “where is capital allocated”; markets answer “what can I compare”. Do not give every item the same visual weight.                                                                                |
| [Mercury: Designing in the open](https://mercury.com/blog/designing-in-the-open)                                                                     | Mercury explains the value of letting potential customers experience the actual product through a public demo before committing.                                                                                                            | The founder's demonstration should lead to a working Sandbox and a real deposit/withdrawal sequence. Product breadth should be visible through working entry points. A non-wallet public demo could be a later product decision; do not silently alter the existing authentication scope. |
| [Stripe Dashboard basics](https://docs.stripe.com/dashboard/basics)                                                                                  | The dashboard separates home, balances, transactions and product areas. Transaction filtering/export and individual-resource details are available where relevant. Sandboxes provide a separate testing context.                            | Group navigation by purpose. Put network/export tools beside the data they affect. Keep the simulation label close to test funds and distinguish it from external/live data.                                                                                                              |
| [Stripe Dashboard search](https://docs.stripe.com/dashboard/search)                                                                                  | Search exposes relevant results first, with expanded resource tables and filters available as the user narrows the task.                                                                                                                    | Keep market search and filters local to Markets. Use summary rows with explicit detail controls instead of opening every chart and allocation panel at once.                                                                                                                              |
| [Morpho vault directory](https://app.morpho.org/vaults) and [Morpho app documentation](https://docs.morpho.org/get-started/resources/app-ecosystem/) | The public directory is organized around comparable vault attributes including network, deposit size, liquidity, curator and APY. The app documentation distinguishes vault participation, position management and risk-related conditions. | Keep the vault comparison table. Use token/network identity beside rates, provide allocation details on request, and distinguish missing data from zero. Label rate provenance and freshness.                                                                                             |

Limitations: the first browser visit loaded Mercury's public product page and Morpho's directory with a connectivity error overlay; repeat visits returned a browser verification checkpoint. We did not inspect an authenticated Stripe/Mercury account or perform competitor financial transactions. No competitor screenshots or logos should be copied into the shipped workspace. Public pages and docs provide reference patterns, not evidence that our implementation will improve conversion.

## Core composition

1. **Header:** Thesauros identity; always reachable Quick guide; Docs; wallet/account; compact mobile Menu.
2. **Page heading:** a concise title and one functional sentence. Avoid stacked promotional headings above the banner.
3. **Brand banner:** retain the approved blue reflections, reduce its height, state the proposition in concrete language. Primary action leads to Sandbox; the secondary action opens the guide. Replace an abstract decorative card with the simple Deposit / Earn / Withdraw product flow.
4. **Account + first steps:** wallet balance on the left; short guided path on the right. On phones the wallet appears directly after the banner, before discovery links. A disconnected wallet is a meaningful reconnect state, not a failed dashboard.
5. **Data section:** vaults and markets previews with visible context. Network filter, refresh and export belong beside this section rather than above the brand banner.
6. **Commercial path:** keep the sidebar “Talk to Thesauros” card. It can carry personality with three small product icons. Developer docs and partner contact should be easy to find without taking over the personal balance experience.

## Visual system

| Element    | Concrete direction                                                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas     | Soft neutral slate `#F4F6F7`; white surfaces; subtle borders `#DFE6EC`. Avoid large gradients outside the single brand banner.                                                                                                               |
| Text       | Primary navy `#112A40`; secondary `#526679`; navy action `#173C5B`. Reserve bright brand blue for the mark or very restrained highlights.                                                                                                    |
| Typography | Keep the existing Onest font. Page title 28–32 px / 1.2, weight 500; section title 20–22 px; body/data 14–15 px; supporting labels 12–13 px. Use tabular numerals for numeric data.                                                          |
| Spacing    | 24–32 px page rhythm, 18–24 px panel padding, 16–20 px between related cards, 12–16 px for row padding. More whitespace around section boundaries, less inside simple controls.                                                              |
| Surfaces   | Radius 14 px for account/data panels; 8–9 px for controls and selected navigation. Modest borders carry hierarchy; avoid a shadow on every card.                                                                                             |
| Navigation | Desktop sidebar 232 px; white background; grouped labels at 12 px; active page navy with white icon/text. Inactive states remain dark enough to read. Sandbox carries a small “Test” badge.                                                  |
| Data       | A single primary value, explicit unit and a nearby label. Preserve timestamps, missing-data states, local horizontal table scrolling, and detailed allocations on request. Do not aggregate unrelated tokens into a fabricated dollar total. |
| Images     | Use the existing soft reflections asset only in the brand banner. Real UI itself should be the main visual proof. No extra stock photos or generated finance scenes inside the workspace.                                                    |
| Icons      | Consistent simple 20 px stroke SVGs, not emoji or typographic arrows. Pair unfamiliar icons with text.                                                                                                                                       |

## Mobile behavior

- Target 320 px and up with no page-wide horizontal scroll. Local wide-data scrolling remains acceptable when columns require comparison.
- Keep Quick guide visible in the header. Account, Docs and secondary tools remain in Menu when space is constrained.
- Provide a bottom dock for the three frequent destinations: Overview, Vaults, Sandbox. Give it at least 52 px touch targets plus the device safe area, and reserve matching content padding.
- Make the wallet visible before any stack of product discovery cards. If cards remain, use compact text rows rather than tall promotional cards.
- Use a single-column flow for balance and onboarding below 760 px; preserve full width inputs, 44 px action targets and readable 16 px form fields.
- Header, dock and overlays need explicit stacking. A menu or quick-guide dialog must make background controls inactive and keep keyboard focus inside it; Escape and a visible Close control must return focus to the opener.

## The quick guide's visual role

The guide should answer three questions before describing technical components: what Thesauros provides; what the visitor can do here; what a safe first action looks like. Keep it available from the header and welcome block. Three or four short steps with concrete actions are enough. It should be dismissible and reopenable, without a compulsory tooltip tour over every navigation item.

An effective first journey is: understand Earn, try a Sandbox deposit, inspect vaults/markets, find the integration path. Use clear completion states only for actions that actually happened. Visiting a section is not evidence that a deposit succeeded.

## Acceptance checks

- At 1440 px, brand context and wallet/first-step context are visible without scrolling past four promo cards.
- At 390 and 320 px, the account follows the banner; navigation and Quick guide remain visible and usable.
- Every prominent CTA has a real destination or action; no decorative controls look clickable.
- Simulated funds and read-only/onchain information have distinct context; no fabricated APY, customer count or deposits appear as product proof.
- Tables remain readable at ordinary zoom, selected filters have clear scope, and unavailable data stays explicit.
- The final production build is inspected, since Next.js CSS chunk ordering can differ from development.

## Implementation scope

This research supports targeted changes to the existing Next.js/CSS Modules interface. No charting library, UI framework, generated media, production wallet transaction or backend migration is required for the visual system. Preserve the already-tested authentication, filter, export and ledger behavior.

## Integrated design review

Reviewed the integrated development build using an ephemeral SIWE account and the real data feeds. Screenshots cover Overview, Vaults, Markets and Account at 1440, 390 and 320 px; no funding, deposit, withdrawal or onchain transaction was performed. Evidence is in the surrounding workspace at `work/evidence/workspace-research-20260920/designer-*.png` and `designer-checks.json`.

- The wallet begins at approximately 517 px on desktop and 548 px at 390 px width, substantially earlier than the previous layout. The brand proposition, mechanism and next action read in a clear sequence.
- Desktop navigation, data tables and Account details have consistent hierarchy and adequate type size. Real observed vault counts, external-market counts, timestamps and last-received states are visible. The screenshots contain four vault rows and sixteen market rows; these are observations of that feed response, not permanent marketing claims.
- All twelve viewport/page combinations have no page-wide overflow or JavaScript errors. This is a Chromium responsive inspection, not a physical iPhone or Safari verification.
- The mobile dock initially inherited the desktop Sandbox “Test” badge as a third line. The badge is now hidden in the dock while preserved in full navigation, returning the dock to aligned icon/label destinations. The infrastructure section title now explicitly uses primary ink.
- The remaining mobile design refinement is to make rate comparisons visible without horizontal scanning. The main implementation is addressing this with mobile vault and market cards. At 320 px the banner can also be slightly shorter so more account content fits above the dock; copy should retain comfortable reading size.

The integrated desktop composition is ready for final compiled-build inspection. Mobile card changes and any later edits require their own final capture.
