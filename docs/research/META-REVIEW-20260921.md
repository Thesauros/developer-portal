# Earn journey review — 21 September 2026

This pass reviews the current working application as a connected product, following the real-contract integration on 20 September. It is an expert interface review supported by browser scenarios, not interviews or measured conversion research.

## Selected changes

- **State-specific entry.** An empty position explains the live minimum and offers a deposit or funding action appropriate to the actual wallet balance. An active position keeps the balance first. Copy does not assume that an empty account has never deposited.
- **Find existing money.** Network selectors show the wallet's own position or available USDC. An empty selected network surfaces an existing position on the other supported network. Selected-network gross APR remains visible in the account card; network comparison remains available in Vault explorer.
- **Finish the funding journey.** The native dialog shows the signed-in wallet's complete address, selected network, native USDC contract and ETH fee requirement. Funding a wallet and depositing into Earn are separate steps. Copy works in the HTTP preview. A failed selected-network refresh remains an error inside the dialog.
- **Progressive detail.** Earn groups known adapters by protocol and shows allocation shares only with complete data. Vault explorer retains individual providers, addresses, rates and controls. Tiny positive wallet balances are not presented as zero. Partial data never becomes a complete allocation chart in the Earn summary.
- **Remove transition errors.** Vault details opens on the network selected in Earn. The empty Transactions action now says “Open Earn”, matching its destination. Input feedback explains minimum, balance and decimal errors before wallet interaction.

## Decisions to preserve

Keep the established navy/white palette, two-column desktop layout, mobile navigation, practical Quick guide, compact partner banner and Build page. The guide and partner path already answer distinct user needs. A separate Portfolio page, invented performance series or another dashboard redesign would add complexity without resolving a demonstrated problem in this pass.

The funding instructions use native USDC addresses already in the verified contract configuration; they were checked against Circle's official list: https://developers.circle.com/stablecoins/usdc-contract-addresses. No onramp, bridge or direct transfer to the vault is introduced.

## Validation and limits

Evidence is stored outside the repository under `work/evidence/meta-review-20260921/`.

- Pure presentation checks cover exact integer grouping, unavailable data, tiny positive balances and strict USDC input precision.
- Browser journeys cover empty and active accounts, other-network discovery, modal keyboard and focus behavior, balance-refresh failure/recovery, correctly labelled routes, complete/partial allocation and mobile layouts down to 320 px.
- The existing engine, history, auth and route checks are rerun. Controlled EIP-1193 scenarios cover approval, deposit, pending reload, full redemption and uncertain wallet submission without broadcasting transactions.
- Public preview verification is read-only, using an ephemeral sign-in. Real mainnet reads are separate from controlled transaction tests; no funded mainnet transaction is submitted by this review.

Publication remains local preview only; no GitHub push, commit or pull request is authorized by this pass.
