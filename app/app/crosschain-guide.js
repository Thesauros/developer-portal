// The "How Earn works" steps for the cross-chain vault.
export const crosschainGuide = [
  {
    short: "Deposit",
    title: "One deposit. Two networks.",
    body: "Deposit USDC on Base. You receive shares in one vault, which lends across approved markets on Base and Arbitrum.",
    detail:
      "You keep USDC in your wallet until you sign. Approve the exact amount, then request the deposit.",
    note: "Approve USDC, then request the deposit.",
    visual: [
      ["wallet", "Your USDC", "On Base"],
      ["vault", "One vault", "Your shares"],
      ["market", "Lending markets", "Base and Arbitrum"],
    ],
    action: "See where the money is",
    destination: "vaults",
  },
  {
    short: "Batches",
    title: "Requests settle in batches.",
    body: "Deposits and withdrawals are collected into a batch and settled together at the next valuation, usually within hours. Then you claim the result.",
    detail:
      "You can cancel a deposit until it is settled. The page shows where each request is on its way.",
    note: "Requested, batch closed, settled, claimed.",
    visual: [
      ["app", "Request", "Joins the batch"],
      ["activity", "Settlement", "At the next valuation"],
      ["vault", "Claim", "Shares or USDC"],
    ],
    action: "Deposit & withdraw",
    destination: "earn",
  },
  {
    short: "Earn",
    title: "Your shares earn through the share price.",
    body: "The markets pay interest to the vault, and the price of a share rises. Your balance is your shares at the latest valuation.",
    detail:
      "Rates are variable. Part of the money stays as cash on Base for withdrawals, so the yield on all capital is lower than the rate of any one strategy.",
    note: "Shares stay the same. Their price moves.",
    visual: [
      ["market", "Markets pay", "Interest to the vault"],
      ["vault", "Share price", "Rises with the interest"],
      ["activity", "Your balance", "Shares at that price"],
    ],
    action: "View the vault",
    destination: "vaults",
  },
  {
    short: "Withdraw",
    title: "Withdrawals work the same way.",
    body: "Request a withdrawal on Base. When the batch settles, claim your USDC.",
    detail:
      "A withdrawal larger than the cash on Base waits until funds return from the strategies. The vault page shows how much cash is ready.",
    note: "Request, settle, claim.",
    visual: [
      ["vault", "Your shares", "Join the batch"],
      ["activity", "Settlement", "At the next valuation"],
      ["wallet", "Your USDC", "On Base"],
    ],
  },
];
