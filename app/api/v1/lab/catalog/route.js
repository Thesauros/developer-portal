/** GET /api/v1/lab/catalog — policies, presets, regimes, metrics and limits. */
import { apiHandler, OPTIONS } from '../../../../../lib/api/http.js';
import { labCatalog } from '../../../../../lib/api/strategy.js';

export { OPTIONS };

export const GET = apiHandler({}, async (request, ctx, api) => api.json(labCatalog()));
