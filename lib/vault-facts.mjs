// What is known about each vault beyond its numbers. Everything here was checked
// against the contracts or the audit reports on 1 November 2026; see
// thesauros-materials/review-20261031/contracts.md. It is the source for the
// Terms, Risks and Transparency sections, and needs sign-off before going public.
export const BATCH_VAULT_ID = "base-arbitrum";
const STANDARD_RISKS = [
  {
    title: "Lending markets",
    text: "The vault lends to third-party markets. If one of them loses money or stops paying out, the vault loses with it.",
  },
  {
    title: "Smart contracts",
    text: "The vault's code was reviewed by Hexens, in October 2025 and July 2026. A review lowers the risk of a bug; it does not remove it.",
  },
  {
    title: "Control",
    text: "Vault administrators can upgrade the code, change fees and pause deposits or withdrawals.",
  },
  {
    title: "Getting out",
    text: "A withdrawal is paid from the markets the vault lends to and depends on the liquidity they have at that moment.",
  },
  {
    title: "The stablecoin",
    text: "Balances are held in a stablecoin and shown at face value. A stablecoin can lose its peg.",
  },
];
export const VAULT_FACTS = {
  arbitrum: {
    audit: { state: "reviewed", label: "Hexens, Jul 2026" },
    risks: STANDARD_RISKS,
  },
  base: {
    audit: { state: "reviewed", label: "Hexens, Jul 2026" },
    risks: STANDARD_RISKS,
  },
  // Live since 21 September 2026 on a later build than the other four; whether
  // the July review covers it is a question for the CTO (REPORT.md).
  ethereum: {
    audit: { state: "partial", label: "Later build than the one reviewed" },
    risks: STANDARD_RISKS.map((risk) =>
      risk.title === "Smart contracts"
        ? {
            ...risk,
            text: "This vault runs a later build of the code than the one Hexens reviewed in October 2025 and July 2026. Whether that review covers the changes has not been confirmed.",
          }
        : risk,
    ),
  },
  monad: {
    audit: { state: "reviewed", label: "Hexens, Jul 2026" },
    risks: STANDARD_RISKS,
  },
  plasma: {
    audit: { state: "reviewed", label: "Hexens, Jul 2026" },
    risks: STANDARD_RISKS,
  },
  [BATCH_VAULT_ID]: {
    audit: { state: "none", label: "No external audit yet" },
    // Shown above the form: what a depositor has to know before anything else.
    notice: [
      "These contracts have not had an external audit yet.",
      "One team key can upgrade the contracts.",
      "Thesauros values the vault off-chain and publishes the share price; the contract checks its limits, not the figure.",
      "A withdrawal settles with a batch. One larger than free cash waits for funds to return from other networks.",
    ],
    risks: [
      {
        title: "No external audit",
        text: "The contracts behind this vault have not been reviewed by an outside firm. The vaults before it were reviewed by Hexens; this code is newer.",
      },
      {
        title: "Control",
        text: "One team key can upgrade the vault's contracts. Changes to lending markets and their limits wait 24 hours in a timelock.",
      },
      {
        title: "Valuation",
        text: "Thesauros calculates the share price off-chain and publishes it to the contract. The contract checks its limits but does not verify the figure. When no fresh valuation is published, settlement waits.",
      },
      {
        title: "Getting out",
        text: "A withdrawal is paid from free cash on Base. A larger one waits until funds return from other networks, and a batch settles only with a fresh valuation. No time is promised.",
      },
      {
        title: "Moving between networks",
        text: "Money moves between networks through Circle's CCTP. A move depends on that service and takes minutes while it is on its way.",
      },
      {
        title: "Lending markets",
        text: "The vault lends to third-party markets. If one of them loses money or stops paying out, the vault loses with it.",
      },
      {
        title: "The stablecoin",
        text: "Balances are held in USDC and shown at face value. A stablecoin can lose its peg.",
      },
    ],
  },
};
// Per the tokenomics document. The contracts charge 0% today.
export const PLANNED_PERFORMANCE_FEE = 25;
export const PARTNER_TERMS = {
  base: 30,
  preToken: 50,
  bonded: 80,
};
export const AUDITS = [
  { firm: "Hexens", date: "Oct 2025", scope: "Previous vault contracts" },
  { firm: "Hexens", date: "Jul 2026", scope: "Previous vault contracts" },
];
