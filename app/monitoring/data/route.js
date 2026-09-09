import { userSession } from "../../../lib/auth.mjs";
import { protocolData } from "../../../lib/live-data.mjs";
export const dynamic = "force-dynamic";
// Compatibility entry for the former monitor; it now uses the unified live feed.
export async function GET(request) {
  if (!(await userSession(request.headers)))
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  return Response.json(await protocolData(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
