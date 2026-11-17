// The "How it works" steps: the vault, a deposit, and what happens after.
export const vaultGuide = [
  {
    short: "The vault",
    title: "One vault for USDC, lent on more than one network.",
    body: "The vault lends USDC across approved lending markets on Base and Arbitrum and shows where the money is. Deposits and withdrawals are requests that settle in batches, so the money can keep working on more than one network.",
    detail:
      "The vault is measured against the Market Average: the lending rate of every market Thesauros vaults may use that holds at least 1 million USD, weighted by size. Rates change.",
    note: "You deposit and withdraw USDC on Base.",
    visual: [
      ["wallet", "Your USDC", "On Base"],
      ["vault", "The vault", "You hold shares in it"],
      ["market", "Lending markets", "Listed on the vault's page"],
    ],
    action: "Open Earn",
    destination: "earn",
  },
  {
    short: "Deposit",
    title: "Approve, request, then collect.",
    body: "You keep your USDC until you sign. First you approve exactly the amount, then you request the deposit. Each step shows in your wallet.",
    detail:
      "Your deposit starts earning when the batch settles. A batch closes every 1 to 2 hours when the vault’s valuations are on time; no time is promised. You can cancel until it settles. Afterwards you collect your shares.",
    note: "Three wallet confirmations: approve, request, collect.",
    visual: [
      ["wallet", "Enter an amount", "In USDC"],
      ["vault", "Approve", "Exactly this amount"],
      ["activity", "Request, then collect", "After the batch settles"],
    ],
    action: "Open Earn",
    destination: "earn",
  },
  {
    short: "Follow",
    title: "Your balance shows what your shares are worth.",
    body: "A share's price rises as the markets pay interest, so you earn without receiving anything. Portfolio shows your balance, how it grew and anything still in progress.",
    detail:
      "Withdrawing is a request too. It settles with a batch and you then collect your USDC. A large withdrawal waits until funds return from another network. No fixed time is promised.",
    note: "Request, batch settles, collect.",
    visual: [
      ["wallet", "Requested", "Sent from your wallet"],
      ["activity", "Settled", "With the batch"],
      ["vault", "Your balance", "Read from the contract"],
    ],
    action: "See your portfolio",
    destination: "overview",
  },
];
