# Strategy Lab

A test stand for routing policies. Configure a strategy, run it against a
market, and find out whether it actually beats the alternatives — or whether
the difference you are looking at is noise.

- **UI**: `/app/institution#integrations/lab`
- **API**: `/api/v1/lab/{catalog,market,backtest,experiments}`
- **SDK**: `client.lab.*` (TypeScript and Python)
- **Code**: `lib/api/strategy.js` (simulator), `lib/api/market-paths.js` (rates),
  `app/views/StrategyLab.jsx` (UI), `test/strategy.mjs` (invariants)

## Why it exists

The sandbox engine (`lib/api/engine.js`) replays one hard-coded policy: move
to the highest APY every 36–96 hours, free of charge. That is enough to make
the API feel alive and useless for deciding whether a policy is any good —
nothing can be changed, nothing is costed, and there is nothing to compare
against.

The lab is the other half. The policy, its costs and its constraints are all
inputs, so two configurations can be run against identical markets and the
difference between them attributed to the strategy rather than to luck.

## What a run answers

Three questions, in order:

1. **Did it beat doing nothing?** Every backtest reports four baselines:
   passive bluechip, route-once-and-hold, equal weight, and the ex-post best
   single venue. The last one requires knowing the future and exists only to
   show the ceiling — how much of the available spread was capturable at all.
2. **Did it beat the alternative policy?** An experiment runs variants against
   the same markets, repeatedly, and reports the paired difference with a 95%
   interval and a win rate.
3. **Is the difference big enough to act on?** A hypothesis states the effect
   you would consider material *before* the run. The verdict will not call a
   2 bps edge a win just because it is statistically detectable.

## Verdict outcomes

| Outcome | Meaning |
| --- | --- |
| `supported` | Right direction, at least `min_effect` in size, and `p < alpha`. |
| `refuted` | Significant, and pointing the other way. |
| `negligible` | Real and detectable, but smaller than the effect you called material. |
| `underpowered` | Fewer than 8 paired samples. A direction, not a result. |
| `inconclusive` | Inside the noise at this sample count. |

`negligible` and `underpowered` exist because the two easiest ways to
manufacture a finding are to run until something crosses `p < 0.05` and to
declare victory on three samples.

## The two rate sources

| | `synthetic` | `historical` |
| --- | --- | --- |
| Rates | Seeded simulation around the sandbox venues | Real daily APY from the DeFiLlama pool charts |
| Samples | Any number of independent markets | Non-overlapping blocks of one history |
| Reproducible | Yes, from `(seed, regime)` | Yes, but it is one fixed past |
| A p-value means | A statement about the rate model | Indicative only — blocks are not independent draws |

Neither is evidence about the future. Synthetic paths describe the behaviour
of a model; historical paths describe rates that really happened to seven
venues over a few months. Both carry their provenance on the response, and the
UI prints it under the result.

**Synthetic regimes** change how the simulated market behaves:

| Regime | Behaviour |
| --- | --- |
| `stable` | Range-bound; leadership rarely changes. Rebalancing has little to capture. |
| `rising` / `falling` | The whole curve moves ~180 bps across the window. |
| `volatile` | Large daily swings and frequent incentive shocks; signals are unreliable. |
| `dispersed` | Venues pull apart and leadership rotates. The regime routing is built for. |

Running the same strategy across all five is the fastest way to learn where a
policy earns its keep and where it just pays fees.

## What keeps the numbers honest

A backtester's failure mode is not a crash. It is a plausible number that
flatters the strategy. Four properties are enforced in code and pinned in
`test/strategy.mjs`:

**No lookahead.** A decision on day *t* sees rates up to and including day *t*
— a supply rate is observable on-chain the moment you look — and never day
*t+1*. The test corrupts every rate after day 45 and asserts the equity curve
up to day 45 is byte-identical. `oracle_best` is the one deliberate exception,
and it is labelled as unattainable wherever it appears.

**Positions, not weights.** The simulator tracks a balance per venue, not a
fixed weight applied to total equity. A constant weight across venues
compounding at different rates is a free daily rebalance — the cheapest way to
invent returns nobody can earn.

**Moving money costs money.** Every move pays a proportional cost plus gas per
venue touched, and the performance fee is charged on yield, so churn has to
out-earn its own friction. `gross_apy` is the same run with no fee, no cost and
no price impact; `drag_bps` is the gap.

**Capital has price impact.** Supplying into a venue dilutes its rate by your
share of the pool, and capacity is a hard cap. A strategy cannot win by
pretending it can put $50M into a $6M market — the test asserts that $500M
earns strictly less than $10k in the same venue.

`cost_aware` deserves a note. A move is judged against `cost_horizon_days`
(default 30), not against the cooldown. Using the cooldown looks more
conservative and is actually broken: at a 48h horizon a full-size move would
need a ~15 percentage point rate edge to clear its own fee, so cost awareness
silently becomes a kill switch and nothing ever rebalances.

## Strategy parameters

Defaults come from `GET /lab/catalog`; every field is optional.

| Field | Default | Meaning |
| --- | --- | --- |
| `policy` | `risk_adjusted` | `hold`, `best_apy`, `risk_adjusted`, `momentum`, `top_k`, `equal_weight` |
| `rebalance_threshold_bps` | 40 | Annualized advantage required before capital moves |
| `min_hold_hours` | 48 | Cooldown after a move |
| `cost_horizon_days` | 30 | Window a move must earn back its cost within |
| `lookback_days` | 7 | Days of rate history the signal smooths over |
| `vol_penalty` | 0.5 | Score penalty per unit of rate volatility |
| `momentum_weight` | 1.5 | Weight on the trend term (`momentum` only) |
| `max_venues` | 1 | Venues held at once |
| `max_alloc_pct` | 1.0 | Cap on any single venue's share |
| `tx_cost_bps` | 3 | Proportional cost of moving capital |
| `gas_cost_usd` | 1.2 | Fixed cost per venue touched |
| `perf_fee_pct` | 0.25 | Protocol fee on positive yield |
| `allowed_tiers` | all three | Risk tiers the strategy may enter |
| `risk_penalty` | 1.0 / 0.92 / 0.82 | APY multiplier per tier |
| `capacity_aware` | `true` | Apply price impact and capacity limits |
| `cost_aware` | `true` | Require a move to earn back its cost |
| `pin_venue` | `null` | Force one venue, ignoring the policy |

## Example

```bash
curl -X POST http://localhost:8879/developers/api/v1/lab/experiments \
  -H "Authorization: Bearer tsk_test_thesauros_sandbox_0000000000000000" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "synthetic",
    "regime": "dispersed",
    "days": 90,
    "samples": 40,
    "variants": [
      { "id": "A", "label": "Threshold + cost aware", "strategy": {} },
      { "id": "B", "label": "Naive APY chaser",
        "strategy": { "policy": "best_apy", "rebalance_threshold_bps": 0,
                      "min_hold_hours": 0, "cost_aware": false } }
    ],
    "baseline_variant": "B",
    "hypothesis": {
      "statement": "A threshold plus cost awareness beats naive APY chasing",
      "metric": "net_apy", "variant": "A", "direction": "greater", "min_effect": 10
    }
  }'
```

```python
from thesauros import Thesauros

client = Thesauros(api_key="tsk_test_thesauros_sandbox_0000000000000000")
result = client.lab.experiment(
    variants=[
        {"id": "A", "label": "Threshold + cost aware", "strategy": {}},
        {"id": "B", "label": "Naive APY chaser",
         "strategy": {"policy": "best_apy", "cost_aware": False,
                      "rebalance_threshold_bps": 0, "min_hold_hours": 0}},
    ],
    baseline_variant="B",
    regime="dispersed",
    samples=40,
    hypothesis={"metric": "net_apy", "variant": "A",
                "direction": "greater", "min_effect": 10},
)
print(result["verdict"]["outcome"], result["verdict"]["observed_effect"], "bps")
```

## Using it in CI

The lab is an API, not a console toy. A strategy change that loses 20 bps
against the shipped default should fail a build, not get noticed in a review:

```bash
node -e '
const r = await (await fetch(process.env.LAB_URL + "/lab/experiments", {
  method: "POST",
  headers: { Authorization: "Bearer " + process.env.LAB_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ samples: 60, regime: "dispersed", variants: [
    { id: "candidate", strategy: JSON.parse(process.env.CANDIDATE) },
    { id: "shipped", strategy: {} }], baseline_variant: "shipped",
    hypothesis: { metric: "net_apy", variant: "candidate", direction: "greater", min_effect: 0 } }),
})).json();
const v = r.data.verdict;
console.log(v.outcome, v.observed_effect, "bps");
process.exit(v.outcome === "refuted" ? 1 : 0);
'
```

Pin `seed` to make the gate deterministic; leave it unpinned to catch policies
that only work on one market.

## Limits

Worth stating plainly, because a backtest invites over-reading:

- Daily resolution. Intraday rate moves and the gas spikes that come with them
  are invisible.
- Rates only. No smart-contract loss, no oracle failure, no bridge risk, no
  depeg, no withdrawal queue, no MEV.
- Execution is assumed to succeed at the quoted rate minus the configured
  costs. Real routing can fail, revert or partially fill.
- Historical mode drops venues that do not cover the whole window, which
  removes survivorship bias in one direction and shortens the window in the
  other. The response says which happened.
- The synthetic model is calibrated by hand, not fitted to data. Its
  volatility, mean reversion and shock frequency are plausible, not measured.
