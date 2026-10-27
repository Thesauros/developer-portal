/**
 * POST /api/v1/lab/experiments — compare strategies and judge a hypothesis.
 *
 * Body: {
 *   mode, asset, days, capital, seed, regime, samples, block_days,
 *   variants: [{ id, label, strategy }],
 *   baseline_variant,
 *   hypothesis: { statement, metric, variant, direction, min_effect, alpha }
 * }
 *
 * Every variant sees the same market on every sample, so the difference
 * between them is the strategy rather than the draw.
 */
import { apiHandler, OPTIONS, readJson } from '../../../../../lib/api/http.js';
import { runExperiment } from '../../../../../lib/api/strategy.js';

export { OPTIONS };

export const POST = apiHandler({}, async (request, ctx, api) => {
  const body = await readJson(request);
  return api.json(await runExperiment(body || {}));
});
