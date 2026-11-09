# Thesauros app: product context

register: product

## What it is

Stablecoin vaults that show where every dollar is, what it earns and how to get it out. People deposit USDC or USDT0; a vault lends it across approved markets and they hold shares whose price rises as the markets pay interest. Partners can put the same vaults in their own products.

## Who uses it

- **A holder.** A few thousand USDC in a wallet they open a few times a month. Knows what Aave is, not what a batch or a share price is. Wants to know which vault, how much it pays, when they can leave and what can go wrong.
- **A partner.** Evaluating an embed for their own users, with twenty minutes before a call. Wants what it is, how big and how proven it really is, what they would earn and who to talk to.
- **An investor.** Sceptical and numerate. Wants total capital, net results against simply using Aave, where every dollar is, what has gone wrong and who is in control.
- **A treasury.** An institution with an email login and a linked wallet, using the same vaults.

## One model

One account in stablecoins, sold as native yield from blue-chip lending across many networks. A vault belongs to a product, named by the stablecoin and how you get out: USDC Instant, USDC Multichain, USDT0 Instant. The network a vault takes deposits on is a choice inside the product, never its name, and network detail (which network, contracts, cash per network) sits in nested places. Vaults differ only in where the money works, how fast you can leave and how proven they are. The words "cross-chain" and "single-network" do not appear in the interface.

## The market

"The market" means one thing everywhere: the blue-chip index. Its members are every lending market a Thesauros vault is approved to use, as the vault contracts list them; each counts by how much it holds; its return comes from each market's own interest index, chained day by day. Every vault, product and the whole of Thesauros are compared with it over the same days, in percentage points. The index page shows its members, weights and method.

The comparison chart puts Thesauros and the index side by side as what 10,000 earned since the start of the period, with three reference lines: T-bills (the on-chain price of Ondo USDY), Aave alone and Compound alone (the index built only from that lender's markets). The references give scale; the gap is always measured against the index.

A quoted rate counts as read unless it jumps: each market's quote is also read at 04:00, 12:00 and 20:00 UTC, and a quote more than 1.5 points (or 30%) away from both of the two readings before it counts only once a later reading confirms it. This keeps out short spikes such as Aave on Ethereum's 40-minute jump to about 12.5% around midnight UTC. What a market earned comes from its interest index and is not affected by quotes at all.

## Where the data comes from

Only Thesauros resources: the vault and market contracts read over RPC, the Thesauros indexer and its SQLite history, and the team's own API and monitor. No outside aggregator and no Monolit service is called by the app; they may be used to check figures during analysis only.

## Principles

1. **A figure that cannot be stated honestly is not shown.** It says why instead: too small to measure, could not be read. Never a false zero, never a guess. The same quantity has one definition and one value on every screen.
2. **Show what is inside.** Where the money is, by market and over time. What moved and when. What went wrong, dated. Who can change the contracts.
3. **Bad news sits next to good news.** An audit that has not happened, a valuation that stopped, a rate below Aave: on the page, in plain words, before someone has to find it.
4. **Say what happens next.** Before a transaction: what you will sign and what follows. After: where it is now, and that you can close the tab. Never promise a time the contracts do not.
5. **Reading needs no wallet.** Connect only to see a balance or to act.
6. **One comparison.** Every rate is set against the blue-chip index over the same days, and the gap is shown in points, good or bad. Reference lines give scale, never a second gap.

## Tone

Plain, exact, calm. Short sentences a person would say. No hype, no urgency, no points or ranks beside money. Rates always say "a year" and "before fees" where that matters.

## Not this

Neon on black. Yield leaderboards. Cards inside cards on grey. A dashboard of tiles with no meaning. Decorative charts. Composite risk scores.

## Money terms

Fees and partner share follow the tokenomics document: 25% performance fee, planned and not charged today; partner share 30%, 50% until 60 days after the token launches, up to 80% with bonded tokens. Differences with other documents are raised with the founders, not settled in the interface.
