// The "How vaults work" steps, for every vault.
export const vaultGuide = [
  {
    short: "Choose",
    title: "Choose the stablecoin and how fast you want to be able to leave.",
    body: "Every vault lends stablecoins across approved blue-chip markets and shows where the money is. Instant vaults pay out in one transaction. The Multichain vault settles requests in batches, so it can keep money working on more than one network.",
    detail:
      "Each vault is measured against the blue-chip index: the lending rate of every market Thesauros vaults may use, weighted by size. Rates change.",
    note: "Pick the network you deposit from inside the vault.",
    visual: [
      ["wallet", "Your stablecoins", "On the network you deposit on"],
      ["vault", "A Thesauros vault", "You hold shares in it"],
      ["market", "Lending markets", "Listed on each vault's page"],
    ],
    action: "See the vaults",
    destination: "vaults",
  },
  {
    short: "Deposit",
    title: "Approve the amount, then confirm.",
    body: "You keep your stablecoins until you sign. First you approve exactly the amount, then you confirm the deposit, and each step shows in your wallet.",
    detail:
      "In a vault that settles in batches, your deposit starts earning when the batch settles. You can cancel until then, and collect your shares afterwards.",
    note: "Two wallet confirmations. A batch vault adds one to collect.",
    visual: [
      ["wallet", "Enter an amount", "In your stablecoin"],
      ["vault", "Approve", "Exactly this amount"],
      ["activity", "Confirm", "A separate transaction"],
    ],
    action: "See the vaults",
    destination: "vaults",
  },
  {
    short: "Follow",
    title: "Your balance shows what your shares are worth.",
    body: "A share's price rises as the markets pay interest, so you earn without receiving anything. Portfolio adds up every vault and shows anything still in progress.",
    detail:
      "Withdrawing works the same way in reverse. A vault that pays out in one transaction depends on the liquidity its markets have; a vault that settles in batches promises no fixed time.",
    note: "Wallet request, network confirmation, updated balance.",
    visual: [
      ["wallet", "Submitted", "Sent from your wallet"],
      ["activity", "Confirmed", "A verifiable receipt"],
      ["vault", "Your balance", "Read from the contract"],
    ],
    action: "See your portfolio",
    destination: "overview",
  },
];
