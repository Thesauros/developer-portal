# Workspace UX strategy

Research date: 20 September 2026. Scope: local Individual workspace and its first
session. Method: source review, competitor desk research and heuristic journey
analysis. This is not an interview study or a claim of validated conversion uplift.

## Product thesis

Thesauros connects financial applications to onchain lending. The partner owns
the customer experience; Thesauros supplies integration/reporting services and a
vault layer. The current Individual workspace lets a visitor inspect the deployed
system and experience simulated Earn. It is simultaneously a useful observation
tool and a working product demonstration.

The first screen must answer: **What is this? What can I do? Which data is live?
What should I try first?** A visitor should not need to infer those answers from
a vault table or a photographic banner.

Local sources: [account access](../ACCOUNT-WORKSPACES.md),
[existing UI audit](../UI-UX-AUDIT.md), `app/app/ProductApp.jsx`,
`WalletCard.jsx`, `TestAccount.jsx`, and the adjacent documentation checkout's
`content/concepts/architecture.md`, `content/start/integration-paths.md`, and
`content/resources/architecture-assurance.md`.

## Evidence from competitors

| Product                                                               | Observed public pattern                                                                                                                                                                             | Implication for Thesauros                                                                                                                                                           |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Opal](https://www.opal.co/)                                          | A direct value proposition leads into the holding/allocating journey; vault information is positioned as decision support. Its public copy separates the stablecoin from optional yield strategies. | Borrow the clear sequence and calm visual confidence. Explain what Earn does before exposing implementation terminology. Do not borrow its Treasury backing or reserve claims.      |
| [Veda](https://veda.tech/)                                            | Leads with embedded Earn inside a partner's app; segments the product by customer use case and offers docs/contact paths.                                                                           | Make the B2B proposition visible inside the demonstration, with a real path from “try it” to “build it”. Avoid representing the individual account as the institution control room. |
| [Veda docs](https://docs.veda.tech/introduction)                      | Describes a vault primitive above underlying protocols, separating infrastructure from the financial applications distributing it.                                                                  | Use a simple product/app, vault, market explanation in the guide. Keep protocol jargon secondary.                                                                                   |
| [Morpho app](https://app.morpho.org/vaults)                           | Its public vault comparison exposes network, token, deposits, liquidity, exposure, curator and APY together.                                                                                        | Keep useful comparison data together. Rates without asset, network and source context are not an institutional presentation.                                                        |
| [Morpho vault docs](https://docs.morpho.org/learn/concepts/vault-v2/) | Explains adapters, allocation and distinct operational roles rather than presenting a vault as a single unexplained yield number.                                                                   | Make allocation inspectable in detail; keep the overview simpler. Do not transplant Morpho's controls into claims about Thesauros.                                                  |

These observations concern public content and visible data structure. Opal's
authenticated app could not be inspected through the web reader; Veda's app
returned no readable content. No claim is made about their authenticated journeys.

## Audiences and first useful outcomes

| Visitor                             | Job to be done                                                           | First useful outcome                                                            | Evidence they need                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Individual                          | Understand the product, inspect my supported wallet balance and try Earn | Find the actual balance or complete a simulated deposit and withdrawal          | Clear wallet/network scope; transaction status; live versus simulated distinction         |
| Prospective integration partner     | Understand what I could put inside my own product and how to integrate   | Inspect a vault, try the customer flow, reach integration docs or contact       | Partner responsibilities, asset/network context, APIs/SDKs, a realistic next step         |
| Investor / founder meeting attendee | Understand the thesis quickly and see credible execution                 | Explain the product in one sentence, observe real data, exercise a working flow | Coherent hierarchy, source timestamps, meaningful interactions, honest product boundaries |

Investor confidence should come from a demonstrably coherent product. Decorative
TVL, invented customer revenue, generic security badges, or unavailable buttons
would weaken the impression under questioning.

## Recommended information architecture

Retain the six actual destinations, grouped visually rather than adding more pages:

- **Workspace:** Overview, Earn Sandbox.
- **Explore:** Vaults, Markets, Activity.
- **Account:** Account settings and sign-out.

Put **Quick guide** in the global header and keep Docs accessible. Maintain a
compact “Build Earn into your product” partner banner with its contact link.
Do not fill the navigation with coming-soon modules. The Institution entry can
continue to explain availability in its existing dedicated route.

Overview hierarchy:

1. A concise brand banner: what the platform is and one clear primary action.
2. A compact first-visit guide entry and a live wallet/position section.
3. Actionable capability cards: inspect vaults, compare markets, follow activity,
   integrate Earn. Each card explains its outcome and has one destination.
4. The live vault/network summary with honest source status; detailed tables and
   charts remain in their dedicated sections.

Avoid reproducing every full table on Overview. The overview should orient,
surface the current state and route the visitor; the dedicated pages support work.

## Recommended product copy

Hero eyebrow: **Thesauros workspace**

Hero headline: **Explore the infrastructure behind Earn.**

Hero body: **Thesauros connects financial apps to onchain lending. Inspect live
vaults and markets, then try the Earn experience with simulated funds.**

Primary CTA: **Try Earn in Sandbox**

Secondary CTA: **Quick guide**

Wallet heading: **Your wallet**

Wallet scope: **Live balances · connected network**

Markets description: **Compare supply rates and pool size across external lending
markets. A listed market is not automatically a Thesauros allocation.**

Activity description: **Protocol activity across your selected networks.**

Sandbox label: **Simulation · no onchain funds**

Use “Add test funds” / “Deposit” / “Withdraw” as working actions inside that
clearly labelled context. Do not use “Start earning” beside read-only live data.

## Quick guide: content and behaviour

The guide is an optional, dismissible dialog, with a clear first-visit invitation
and a permanent way to reopen it. Do not interrupt the first session with a chain
of forced tooltips. Store only guide dismissal/completion locally; do not claim
that viewing a page means completing a deposit.

Title: **A quick introduction to Thesauros**

Intro: **Explore the live infrastructure, try the customer experience, and see how
Earn could fit your product.**

| Step | Heading                       | Body                                                                                                                                                                                                                 | Action                 |
| ---- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1    | Understand the product        | Thesauros connects financial apps to onchain lending. A vault holds an asset position and allocates through its configured providers. Your app owns the customer experience.                                         | Next                   |
| 2    | Explore the live system       | Vaults shows assets and allocations. Markets compares external lending opportunities. Activity shows protocol transactions. Network filters apply to these views; your wallet balance follows its connected network. | Explore vaults         |
| 3    | Try Earn without moving funds | Open Sandbox, add test USDC, then deposit and withdraw. Balances and yield are simulated and saved to this test account. These actions do not send an onchain transaction.                                           | Open Sandbox           |
| 4    | Bring Earn into your product  | The integration guides cover customer flows, APIs and SDKs. Start with your asset, network and account model, then talk to the team. The Institution workspace is coming soon.                                       | Read integration guide |

Optional plain-language glossary, available without leaving the guide:

- **Vault:** a contract that represents an asset position and its configured allocations.
- **Supply APY:** an annualized rate reported by a source, not a guaranteed return.
- **Allocation:** where a vault places its assets across its configured providers.
- **Pool TVL:** the value reported as deposited in a market pool; it does not establish immediately withdrawable liquidity.

Behaviour requirements: keyboard-operable tabs/steps; Escape closes; focus enters
and returns to the invoking button; touch targets at least 44 px; no timed
auto-advance; the chosen guide action closes the dialog and opens its destination.
“Back” and “Close” are always available. Keep content inside a viewport-bounded
scroll area on mobile rather than behind a cropped dialog footer.

## What is actually available

| Capability                                      | Current state                                                                            | UI promise                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Wallet sign-in                                  | Implemented using SIWE; signature is not a token approval                                | Sign in with your wallet                                                    |
| Supported wallet balance and position           | Read-only provider calls on the connected chain; current view reads the configured vault | View supported balances; do not imply a complete multichain portfolio       |
| Vault, provider, rate and activity observations | Live/retained source data with possible partial availability                             | Inspect data and its timestamp; preserve unknown versus zero                |
| External lending market comparison              | Configured stablecoin universe with search, filters and details                          | Compare listed markets; do not imply every listed source is used by a vault |
| Simulated deposits and withdrawals              | Persistent individual ledger, funded explicitly with test USDC                           | Try the Earn lifecycle in Sandbox                                           |
| Documentation and SDK/API resources             | Available through documentation                                                          | Learn how to integrate                                                      |
| Institution workspace                           | Coming soon; prior UI exists behind the gate                                             | Contact / docs, not “manage your company”                                   |
| Real onchain deposits from this workspace       | Not implemented in this Individual UI                                                    | No live deposit CTA                                                         |
| Partner API signing customer transactions       | Not a general-purpose API capability                                                     | Explain attribution/reporting separately from transaction authorization     |

Do not use a blanket “audited platform” badge. The local assurance documentation
states that the Hexens report covers specific contract revisions; it does not
automatically cover the portal, backend, SDKs, or every newer contract.

## Mobile and readability priorities

Use a stable shell, 15–16 px body text, at least 13 px secondary data, strong
contrast and tabular numerals. Keep one primary action per context. Avoid noisy
gradient borders and micro-labels. Photography belongs in one concise banner;
working data belongs on calm solid surfaces.

At 320–430 px, put the proposition and primary CTA before decorative artwork.
Stack comparable cards; local table scrolling must not create body overflow.
Expose a clear menu and page title. Keep source status close to its data rather
than repeating disclaimer-like paragraphs everywhere. Test zero, loading, stale,
error and populated states, not just a showcase screenshot.

## First-session acceptance journey

1. After sign-in, a first-time visitor can describe Thesauros and find a next action
   from the first screen. The guide is visible but does not block browsing.
2. The visitor opens the guide and understands the live/simulated distinction.
3. A vault comparison is reachable in one action; asset, network and rate context
   remain visible together. Filter state is consistent across data pages.
4. The visitor enters Sandbox, adds test funds, deposits, withdraws and sees saved
   transaction history. The action result is clear and failures are recoverable.
5. A partner reaches integration documentation or contact without hunting in a
   marketing footer. The Institution boundary stays explicit.
6. All of the above work at 390 px and with a keyboard. Reopening the guide,
   returning from details, and sign-out remain easy to find.

Follow-up research after review: run five moderated sessions split between a
fintech PM, engineer, individual DeFi user and investors unfamiliar with the
project. Ask them to explain the product and complete the journey without hints.
Measure misunderstood labels, first-click choices and recovery from empty data;
do not substitute an internal visual review for that user evidence.
