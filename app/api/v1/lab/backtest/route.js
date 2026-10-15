/**
 * POST /api/v1/lab/backtest — run one strategy against one market window.
 *
 * Body: { mode, asset, days, capital, seed, regime, venue_ids, strategy }
 * Every field is optional; omitting `strategy` runs the shipped defaults.
 */
import { apiHandler, OPTIONS, readJson } from '../../../../../lib/api/http.js';
import { runBacktest } from '../../../../../lib/api/strategy.js';

export { OPTIONS };

export const POST = apiHandler({}, async (request, ctx, api) => {
  const body = await readJson(request);
  return api.json(await runBacktest(body || {}));
});
