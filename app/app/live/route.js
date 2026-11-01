import { workspaceSession } from "../../../lib/auth.mjs";
import { overLimit } from "../../../lib/public-guard.mjs";
import {
  protocolData,
  blueChipData,
  marketData,
  marketHistory,
} from "../../../lib/live-data.mjs";
export const dynamic = "force-dynamic";
export async function GET(request) {
  const query = new URL(request.url).searchParams;
  // Market rates are public data. The protocol view carries operational alerts.
  if (query.get("kind") === "protocol") {
    if (!(await workspaceSession(request.headers)))
      return Response.json({ error: "Sign in to continue." }, { status: 401 });
  } else if (overLimit(request))
    return Response.json({ error: "Too many requests." }, { status: 429 });
  let data;
  switch (query.get("kind")) {
    case "protocol":
      data = await protocolData();
      break;
    case "markets":
      data = await marketData();
      break;
    case "bluechips":
      data = await blueChipData();
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
