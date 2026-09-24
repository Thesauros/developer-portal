# Product visual reset

20 September 2026. Follow-up expert assessment of the current workspace and its
desktop/mobile evidence. This document describes the new composition and its
implementation contract; it does not claim usability interviews or investor
validation.

## Why the previous iteration still feels incomplete

The navigation and tables are cleaner, but the core sequence still resembles a
marketing page placed inside a dashboard. A large proposition banner occupies
the first viewport. Wallet context, the practical next action and the difference
between actual funds and a simulated experience arrive later. At 320 px the
wallet action is close to the bottom navigation before any financial information
is visible. On desktop a disconnected wallet creates a large empty white panel.

Evidence: `work/evidence/workspace-research-20260920/final-firstscreen-1440.png`
and `final-firstscreen-320.png`. Source review: `workspace.module.css`,
`intro.module.css`, and the prior research summary.

The next change must be an information-architecture change. More cards, another
banner or a different radius will not resolve the product's unclear centre.

## The product centre

Treat this as a capital workspace: **what I have, what can earn, what I can do
next, and how I can inspect the underlying infrastructure**. A visitor should
understand the product by seeing its useful functions, not by reading a second
landing page inside their account.

Recommended hierarchy:

1. A short page title, connected-wallet context and an optional quick-guide
   action. Avoid a slogan above another slogan.
2. A prominent personal balance and a companion Earn panel with a clear next
   action. If the wallet is disconnected, make reconnect the useful action and
   leave unavailable values explicit. Do not replace unknown values with zero.
3. Positions, with asset, network, current value and the action available for that
   position. An empty account gives a short explanation and a deposit entry.
4. Available vaults with comparable metrics and a specific action. Distinguish
   an observed market from a configured, transactable Thesauros vault.
5. A compact commercial module: Build Earn into your product / Talk to Thesauros.
   Retain brand character through product icons, not a tall decorative photo.

Actual wallet actions belong in **Earn**. A clearly labelled Sandbox remains a
separate place to practise. Navigation should reflect this distinction instead
of making the simulator the only visibly functional product.

## Composition

The left balance surface is bright and calm, with one large number and an
explicit token unit. The companion Earn surface is deep navy. Whitespace and
type size create hierarchy; borders group related information and do not frame
every sentence. A short onboarding rail carries one useful introduction plus
the guide action. A pale compact partner banner follows product functionality.

The Earn page uses a content column and a persistent transaction column on wide
screens. The transaction panel carries token/network selection, amount, wallet
balance, estimated outcome and the explicit next step. The entire transaction
remains readable when it becomes a single column on mobile.

The design retains Onest, brand navy and restrained cobalt. Cobalt marks the
primary financial action; it should not colour every label or decoration. No
invented asset values, historical performance, rates, charts or trust claims are
introduced to fill empty areas.

## Interaction requirements

- Real deposit and withdrawal require a wallet-controlled confirmation. A CTA
  starts a review flow; it must not silently submit a transaction.
- Network mismatch is a recoverable state with a clear network-switch action.
- Show the amount, token, chain and destination vault before confirmation.
- If an approval is required, explain approval and deposit as separate steps.
  Prefer approval for the requested amount over unexplained unlimited approval.
- The UI distinguishes wallet confirmation, submitted transaction, confirmation
  and completion. Rejected wallet requests return to an editable form.
- Do not invent exact receive amounts, gas, APY or withdrawal liquidity when the
  contract or data source has not supplied them.
- Empty, loading, partial, disconnected and failure states retain a useful next
  action. An empty account is not a failed product.
- Keep the guide dismissible and reopenable. It explains what Thesauros does,
  actual Earn versus Sandbox, and how to inspect/withdraw a position.

## CSS implementation contract

New file: `app/app/product.module.css`. Use `className={p.product}` around the
new view so its tokens and focus rules apply. Existing legacy panels may retain
their own CSS until incorporated into the new page structure.

| Component | Classes |
| --- | --- |
| Page context | `pageHeader`, `eyebrow`, `pageTitle`, `pageDescription`, `headerActions` |
| Controls | `primaryButton`, `secondaryButton`, `textButton`, `inlineActions` |
| Portfolio | `portfolioGrid`, `balancePanel`, `earnPanel`, `panelHeader`, `balanceLabel`, `balanceValue`, `balanceUnit`, `balanceMeta`, `balanceActions` |
| Positions | `sectionHeader`, `sectionCopy`, `positionList`, `positionRow`, `positionIdentity`, `positionValue`, `emptyState`, `emptyIcon`, `tokenIcon` |
| Vault catalogue | `marketGrid`, `marketCard`, `marketCardHead`, `marketToken`, `marketName`, `networkTag`, `marketMetrics`, `metric`, `metricLabel`, `metricValue`, `cardFoot`, `dataNote` |
| Guidance / partner | `guideRail`, `guideText`, `campaign`, `campaignCopy`, `campaignArt` |
| Transaction | `earnLayout`, `transactionPanel`, `modeTabs`, `tab`, `formLabel`, `amountField`, `amountInput`, `amountBalance`, `transactionDetails`, `reviewStep`, `transactionFooter` |
| State | `stateMessage`, `pending`, `error`, `success`, `statusDot` |

`earnPanel` is a modifier of `balancePanel`. `pending`, `error` and `success`
modify `stateMessage`. `tab` uses `aria-selected="true"` or
`aria-pressed="true"`; use the appropriate native semantics in the component.
`transactionDetails` expects a description list with a wrapper per dt/dd pair.
`campaignArt` expects three noninteractive icon containers; decorative art must
be hidden from assistive technology. Cards should retain an explicit labelled
action rather than presenting a noninteractive card as clickable.

## Responsive rules and review

The portfolio changes from two columns to one at 760 px; the Earn transaction
column becomes ordinary document flow at 1060 px. Vault cards change from three
columns to two to one. Touch targets remain at least 44 px for primary controls;
amount and select fields use at least 16 px text. Long addresses and values must
wrap, and no viewport-wide horizontal scroll should appear at 320 px.

Inspect actual integration at 320, 390, 768, 1280 and 1440 px, including:
disconnected wallet, wallet connected without positions, existing position,
unavailable data, wrong network, amount entry, review and transaction outcome.
Confirm the first screen contains useful account/action context rather than a
tall marketing element. Check compiled CSS ordering, keyboard focus and mobile
bottom-navigation clearance. Screenshot review alone does not prove transaction
correctness; wallet/contract behaviour needs separate validation.

No media generation, animation dependency, authentication change or backend
change is required by this visual system. This implementation remains local for
user review; publication requires an explicit instruction.
