# Partner and investor workspace — discussion in progress

User decisions on 21 September 2026:

- Primary audiences: prospective partners and investors. Individual is a future-facing product view.
- First use must explain the proposition without a presenter. Use a short entry Quick guide about the partner's product and Thesauros infrastructure; avoid a compulsory cinematic walkthrough.
- After the introduction, users explore independently. Surface rates, historical yield, allocation, rebalance actions and institutional developer tools with current API endpoints.
- Recover the useful information from bastardgreeks and developer.thesauros, organizing it coherently rather than reducing the product to a personal Earn balance.
- Explicit immediate action: remove Institution Coming soon and allow wallet sign-in.
- Remaining organization/design work is being discussed; the current Institution access release does not claim to deliver the redesigned information architecture or automatic guide.

## Candidate organization — not yet implemented

Overview; Performance; Vaults & operations; Your capital; Developers. The first screen should provide a sourced operating summary, with deposit testing and integration tools as direct next actions. The user has been asked whether the first screen should emphasize the platform, the partner's own product/economics, or both equally.

## Source inventory

`LivePanels.jsx` retains the old Protocol/VaultDetails reporting: historical rates, lifetime figures, protocol fees, rebalance costs, indexing coverage and alerts. ProductApp currently displays the current-state VaultExplorer in its place. DeveloperTools and its seven views remain in source but are disconnected from ProductApp. The current Build page provides integration resources.

Historical observations need chain, vault address and time-range identity. Monitor coverage may include older deployments. The existing event normalizer does not retain enough fields to establish a specific current vault's complete rebalance history.

The built-in `/api/v1` Sandbox and the Nest Partner API have different contracts. The old API explorer lists sample position mutations; these are not equivalent to onchain transactions or current Partner API endpoints. The Nest API includes partner summary/customer/capital/revenue endpoints, rate history, analytics, reconciliation and operational resources. Its database seed and snapshot mechanism do not themselves prove that a deployment's historical values are ingested from the chain.

Wallet sign-in permits the institutional interface. It does not grant a wallet company ownership, partner API credentials or admin scopes. Partner-specific data requires verified organization mapping and authorization.

## Access-only release

Both entry views use the existing SIWE identity and wallet-scoped personal Sandbox. Institution route, login return destination, session mismatch, sign-out and legacy monitoring access retain the selected view. Old company ledger access stays restricted. Marketing links lose Coming soon. No database migration or GitHub publication.
