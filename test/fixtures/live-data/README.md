# Public data fixtures

Recorded public monitor responses and DeFiLlama observations from the preview
review on 2026-09-07. They contain no account or credential data.

- `networks.json`: https://bastardgreeks.thesauros.io/api/networks
- `baseRebalancer.json`, `arbitrumRebalancer.json`: the same monitor's
  `/api/dashboard?network=baseRebalancer` and `?network=arbitrumRebalancer`.
- `pools.json`: https://yields.llama.fi/pools, trimmed to supported providers
  and the first 25 observations. Observation fields are unchanged.

These fixtures are for deterministic tests, not current market claims.
