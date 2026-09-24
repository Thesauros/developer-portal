# Product reset: a working Earn account

20 September 2026. Product-design review of the current workspace, the archived
Thesauros app, public competitor interfaces and first-party documentation.
This is expert research and a proposed implementation specification, not an
interview study or a claim of measured conversion improvement. No wallet
transactions, private environment files or customer databases were used.

## The decision

Make the product a place to **put USDC to work, understand the resulting position,
and withdraw it**. The existing workspace is a guided catalogue of infrastructure
and a simulated account. Its page order and navigation reinforce that limitation.
More explanations, onboarding cards and marketing banners cannot fix a missing
primary job.

The new main screen should be **Earn**, with an actual supported vault, its
network, a real account position and a complete deposit/withdrawal control.
Personal money is the centre of the product. Infrastructure is inspectable
evidence. The partner proposition is a natural continuation of a working
customer experience. Sandbox remains available for rehearsal.

This is a change in product hierarchy, not a recommendation to manufacture
balances, rates, traction, transaction success or unsupported contract features.

## What changed in the diagnosis

| Current experience | Why it stops short | Reset |
| --- | --- | --- |
| Large proposition banner followed by a first-steps panel | Two introductions precede the user's actual task | One compact brand statement; the operative account and action occupy the first viewport |
| Wallet card is read-only and subordinate to Overview | A balance has no next action | Position, available funds and Deposit/Withdraw form one unit |
| Vaults and Markets have the same prominence as Sandbox | Visitors must infer which is investable, observable or simulated | Earn is primary; vault evidence and external market comparison are secondary |
| Main CTA opens a fixed-rate simulation | A partner or investor cannot see the real integration in operation | Real contract flow where verified; an explicitly separate Sandbox remains available |
| Activity means protocol-wide events | A user reasonably expects their own financial history | Keep protocol scope explicit; personal transactions have their own labelled surface |
| Guide describes the navigation | Knowing menu labels does not teach a deposit decision | Guide answers what happens to money, what must be signed and how to exit |
| Counts of observed vaults and markets substitute for proof | Breadth of a feed says little about product quality | Present actual vault identity, allocation, position and verifiable receipts |

The archived app correctly placed “My deposit”, a yield rate and Deposit/Withdraw
together. That operational arrangement is worth recovering. Its points, static
10% illustration and unconditional instant-withdrawal claims are not.

## Fresh reference evidence

### Morpho: a decision surface with a transaction next to it

The [current vault directory](https://app.morpho.org/vaults) compares network,
vault identity, deposits, liquidity, exposure, curator and APY. A
[public USDC vault detail](https://app.morpho.org/base/vault/0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9/steakhouse-prime-usdc)
places a deposit amount, network and wallet connection alongside vault-specific
information, then offers allocation, performance, risk and activity detail.
This makes inspection and action part of one decision. Thesauros should adopt
that relationship while using a simpler Earn account as its default; it does
not need Morpho's full marketplace complexity on its first screen.

Morpho's [app documentation](https://docs.morpho.org/get-started/resources/app-ecosystem/)
also distinguishes deposit availability, liquidity and other risk conditions.
The design lesson is to locate actionable conditions beside the transaction,
not to copy Morpho's vault mechanics or guarantee the same withdrawal paths.

### Aave: money and wallet stages are explicit

Aave's first-party [supply flow](https://aave.com/help/supplying/supply-tokens)
starts from assets held in the connected wallet, distinguishes an approval from
the supply transaction, and returns the completed position to the dashboard.
Its [withdrawal flow](https://aave.com/help/supplying/withdraw-tokens) begins with
the user's existing supplies and acknowledges available liquidity.

Apply this to Thesauros as distinct steps with visible progress. An approval is
not a successful deposit. A transaction hash is not a confirmed position. A
quoted position value is not guaranteed immediately withdrawable liquidity.
Borrowing and collateral controls are not relevant to this Earn product.

### Summer.fi: recovery matters as much as acquisition

On the research date, [Summer.fi](https://summer.fi/) states that its app has been
deactivated and Lazy Summer is in withdrawal-only mode. Its public interface
prioritizes finding and exiting positions. It therefore cannot be treated as a
current growth-interface reference without that qualification.

The useful lesson is operational: an existing depositor must still find their
position and withdrawal action when new deposits are disabled. Do not make a
single global “unavailable” state hide exit controls.

No competitor financial transaction or authenticated account was tested. These
are public interface observations and first-party flow descriptions.

## Information architecture

Keep the interface compact. One personal account, an infrastructure explorer,
and partner resources are sufficient; do not create a new card for every API.

| Level | Label | User question | Existing functionality to retain |
| --- | --- | --- | --- |
| Primary | Earn | What can I deposit, what is mine, and how do I withdraw? | Wallet reads, plus verified real contract execution |
| Primary, if multiple positions warrant a separate page | Portfolio | What do I hold across supported vaults and networks? | Position readouts; never imply complete wallet coverage |
| Explore | Vaults | Where does deposited capital go? | Allocation, performance, identity, source and CSV |
| Explore | Markets | What external lending opportunities can I compare? | Search, protocols, network multiselect, sorting, history |
| Explore | Protocol activity | What has happened in these contracts? | Indexed events, sources, filters and exports |
| Tools | Sandbox | Can I rehearse without moving real funds? | Current persisted funding/deposit/withdrawal simulation |
| Tools | Build with Thesauros | How does this become part of my app? | Integration docs and partner contact |
| Utility | Quick guide / Account | Help, wallet identity and access | Existing accessible guide, account and sign-out |

For the immediate release, Portfolio can be the position section within Earn;
do not ship a mostly duplicated page. Keep existing hashes as aliases if labels
change. A global network observation filter belongs to Explore. An Earn network
selector selects a real deployment and explicitly asks the wallet to switch
before execution; these are different controls.

On mobile, use Earn / Vaults / More as the compact persistent navigation. Sandbox
does not deserve a third of the bottom dock once real Earn exists. The open
transaction form must not compete with a dock, cookie panel or floating banner.

## Exact first-screen composition

### Desktop

Use a calm light canvas, a narrower nav and one short dark brand surface.
Retain Onest, deep navy and approved reflections as restrained brand texture.
Use 32–40 px for the position, 24–28 px for the page title, 14–16 px for ordinary
text and 12–13 px only for secondary metadata. Show useful density without
duplicating information across three cards.

1. **Header:** Thesauros / Quick guide / wallet identity and network.
2. **Title:** “Earn” with one sentence: “Put USDC to work through Thesauros vaults.”
3. **Primary two-column area:** account summary on the left, action form on the
   right. The transaction should be reachable before scrolling at 1440×900.
4. **Position summary:** “Your Earn balance”, value and explicit USDC unit;
   “Available in wallet”; selected vault and network. Add historical earned
   yield only if deposits, withdrawals and transfers permit a defensible
   calculation. Otherwise omit it instead of showing a fake zero.
5. **Action form:** Deposit / Withdraw tabs; selected network and asset; amount;
   available balance; Max; transaction-specific preview; a contextual primary
   action. These controls operate on the same selected vault as the summary.
6. **Below:** “Where your USDC works” with the actual allocation, and an adjacent
   concise vault facts block: contract link, source time, variable rate, fees
   when verified, and a link to controls/security documentation.
7. **Recent personal actions:** confirmed local receipts or a correctly indexed
   personal feed, explicitly scoped. Broader protocol history remains separate.
8. **Partner continuation:** “Bring this experience into your app.” A restrained
   banner with “Read integration docs” and “Talk to Thesauros”. Preserve the
   user's requested icon treatment. Avoid repeating the same promo in header,
   sidebar, main content and footer.

### Empty position

Title: **“Your first Earn balance starts here.”**

Copy: “Choose a vault, review its allocation, then deposit USDC from your wallet.”
When the wallet has a supported balance, show it and lead into the real amount
input. When it does not, say “No USDC available on [network]” and provide network
selection plus an optional “Try with test funds” link to Sandbox. Do not invent
an onramp, bridge or faucet. Do not fill an empty portfolio with decorative
charts or an invented return estimate.

### Existing position

Show the actual position first. Both **Deposit** and **Withdraw** are available
next to it; the product must not require rediscovering a vault to manage it.
If there are multiple supported positions, use compact rows with asset, network,
current asset value, rate when known, and **Manage**. A total may aggregate the
same asset but must not silently treat different stablecoins as dollars.

### Mobile

Order: title/network → compact position summary → Deposit/Withdraw control →
amount and action → allocation → deeper evidence. Keep the action within the
first or second viewport; do not stack a guide and promo above it. Use 16 px
amount input text and 44 px minimum practical control targets. Network labels
must remain readable beside amounts. The native keyboard may cover the lower
screen, so focused fields and transaction status must scroll into view.

## The deposit and withdrawal journeys

### Deposit

1. Select a verified deployment and inspect its identity/rate/allocation. A
   missing analytics APY must not fabricate a rate or automatically break
   independent direct contract reads.
2. Read wallet asset balance, vault shares and conversion from a coherent block.
   An unsupported chain offers **Switch to [network]**; it is not a zero balance.
3. Enter an amount. Show available funds, token and network. Validate integer
   precision and limit amounts using raw token units.
4. Review the exact amount and contract. If allowance is insufficient, label
   the action **Approve USDC** and explain this is stage 1 of 2. Exact-amount
   allowance is the conservative default; the interface should not silently
   request unlimited allowance.
5. After approval confirms, show **Deposit [amount] USDC** as the next action.
   Recheck account, chain, amount and allowance before requesting the wallet.
6. Present wallet-requested, submitted and confirmed as separate states. Keep
   explorer access after submission and preserve the entered amount on rejection.
7. Only a successful receipt completes the flow. Refresh balances, highlight the
   real updated position and show **View transaction** plus **Done**.

### Withdraw

Start from the existing position, show the asset and destination wallet, then
offer a partial asset amount or an explicit full-share redemption path. Preview
the output and simulate the exact call when supported. A failure to simulate
must not be converted into an “instant withdrawal” promise. Completion returns
the user to a refreshed wallet/position state with the receipt accessible.

The local optimized Rebalancer source deliberately returns zero from all four
ERC-4626 `max*` methods because provider limits are external. A generic
`maxWithdraw() === 0` check would therefore incorrectly disable withdrawals.
The contract integration owner must verify the deployed implementation and
derive transaction availability from its real semantics. “Max” means the
selected position's intended full redemption, not an invented liquidity quote.

## Loading, failure and transaction language

| State | Presentation and recovery |
| --- | --- |
| Initial read | Stable skeleton in the amount/position slot; “Reading your position…”; no flashing zero |
| Background refresh | Keep last received values, show refresh status and time; disable execution if required state is uncertain |
| Analytics unavailable | “Rate unavailable” beside the rate; keep independently verified balances/contract controls usable |
| Wallet disconnected | “Connect your wallet to manage this position”; keep public vault context visible |
| Wrong account | Clear account mismatch, switch/re-authenticate action; never submit for a stale address |
| Wrong chain | “Switch to [network]”; do not ask for token approval before switching |
| No funds | Named asset/network empty state and useful next choice; no disabled unexplained Deposit button |
| Invalid amount | Specific inline message; preserve input, do not clear on blur |
| Approval requested | “Confirm USDC approval in your wallet” and stage 1 of 2 |
| Approval complete | “USDC approved. Continue with your deposit.”; no success state for the whole journey |
| Transaction submitted | Pending receipt with explorer link and hash; prevent duplicate submission |
| Wallet rejected | “Request cancelled. Your amount is still here.”; return to a retryable action |
| Transaction reverted | Explain failure using known reasons when possible, keep receipt and input; never show funds as moved |
| Timeout after submission | “Confirmation is taking longer”; retain hash and reconcile before allowing a second identical action |
| Deposit paused | Disable new deposits with the actual reason; retain withdrawal/position independently when contract allows it |
| Insufficient liquidity | Show the actual failed condition, retain balance, offer retry and details; do not claim a lock period or guaranteed instant exit |
| Confirmed | Updated balance and verifiable receipt; no confetti or full-screen marketing detour |

## A guide for the job, not a tour of the menu

Keep Quick guide reopenable and optional. Three concise practical steps are
enough; retain accessible close, keyboard focus and small-screen behaviour.

1. **Choose where to earn.** “Select a network and review the USDC vault. The
   displayed rate is variable.” Action: **Explore the vault**.
2. **Make a deposit.** “Approve USDC if needed, then confirm your deposit in your
   wallet. These are separate actions.” Action: **Open deposit**.
3. **Stay in control.** “See your position and its allocation. Withdraw to your
   wallet when the contract and available liquidity allow.” Action: **Manage Earn**.

Below the guide: **Prefer a rehearsal? Open Sandbox.** A separate short partner
link can explain how this customer experience fits inside a branded app.
Opening a page is not completion of a financial step.

## What makes the founder demonstration credible

The 90-second walkthrough should show one coherent chain of evidence: actual
deployment → sourced position and allocation → intelligible transaction stages →
confirmed receipt if a human chooses to transact → refreshed position → clear
integration path. An unfunded visitor should still understand the full flow and
reach Sandbox without being trapped at a disabled button.

Preserve honest boundaries: available networks versus observed networks,
personal funds versus vault totals, verified receipts versus protocol-wide
events, and real funds versus simulation. These are useful product distinctions,
not a reason to blanket every screen with disclaimers.

## Release acceptance

- Earn reads as the product's primary job without opening Quick guide.
- A supported depositor finds both Deposit and Withdraw within one screen.
- An unfunded first visitor has a clear useful next action.
- Every displayed financial number has a named source and meaningful unit.
- Wallet rejection, approval-only completion, delayed receipts, chain changes,
  account changes, read failures and liquidity failure have recoverable states.
- Desktop and 320/390 px mobile retain the primary task without page overflow.
- Real contract execution is tested with mocks/read-only simulation or a local
  fork; the agent does not send funded transactions to prove the UI.
- Existing filtering, exports, simulation and authentication remain reachable.
- The local preview is reviewed before any explicitly authorized GitHub push.

Source inspection: current `ProductApp.jsx`, `WorkspaceIntro.jsx`, `WalletCard.jsx`,
`QuickGuide.jsx`, `lib/live-data.mjs`; archived `published/app/screens/dashboard.txt`;
optimized `contracts/Rebalancer.sol`. The old PRD is unfinished research with
unverified numerical claims and is not evidence for shipped product promises.
