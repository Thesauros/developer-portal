/**
 * GET /api/v1/lab/market?mode=&asset=&days=&seed=&regime=
 *
 * The rate paths a backtest would run on, without running one. Lets a client
 * plot the market first and confirm the venues and the window before
 * committing to a strategy.
 */
import { apiHandler, OPTIONS } from '../../../../../lib/api/http.js';
import { buildPaths } from '../../../../../lib/api/market-paths.js';

export { OPTIONS };

export const GET = apiHandler({}, async (request, ctx, api) => {
  const { searchParams } = new URL(request.url);
  const paths = await buildPaths({
    mode: searchParams.get('mode') === 'historical' ? 'historical' : 'synthetic',
    asset: searchParams.get('asset') || 'USDC',
    days: Number(searchParams.get('days')) || 90,
    seed: searchParams.get('seed') || 'lab',
    regime: searchParams.get('regime') || 'stable',
  });

  return api.json({
    object: 'lab_market',
    mode: paths.mode,
    provenance: paths.provenance,
    asset: paths.asset,
    days: paths.days,
    seed: paths.seed,
    regime: paths.regime,
    start: paths.start,
    step_ms: paths.step_ms,
    warnings: paths.warnings,
    venues: paths.venues.map((v, i) => ({ ...v, apy_series: paths.series[i] })),
  });
});
