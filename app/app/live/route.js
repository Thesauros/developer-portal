import { workspaceSession } from "../../../lib/auth.mjs";
import {
  protocolData,
  marketData,
  marketHistory,
} from "../../../lib/live-data.mjs";
export const dynamic = "force-dynamic";
export async function GET(request) {
  if (!(await workspaceSession(request.headers)))
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const query = new URL(request.url).searchParams;
  let data;
  switch (query.get("kind")) {
    case "protocol":
      data = await protocolData();
      break;
    case "markets":
      data = await marketData();
      break;
    case "history":
      data = await marketHistory(query.get("pool"));
      if (!data)
        return Response.json({ error: "Market not found." }, { status: 404 });
      break;
    default:
      return Response.json({ error: "Unknown data view." }, { status: 400 });
  }
  return Response.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
