import { workspaceSession } from "../../../lib/auth.mjs";
import { overLimit } from "../../../lib/public-guard.mjs";
import { protocolData } from "../../../lib/live-data.mjs";
import { marketHistory, marketList } from "../../../lib/market-history.mjs";
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
  try {
    switch (query.get("kind")) {
      case "protocol":
        data = await protocolData();
        break;
      // Both names answer with the markets the vaults may use, from the
      // Thesauros indexer; "bluechips" is kept for links made before.
      case "markets":
      case "bluechips":
        data = marketList();
        break;
      case "history":
        data = marketHistory(String(query.get("pool") || ""));
        if (!data)
          return Response.json({ error: "Market not found." }, { status: 404 });
        break;
      default:
        return Response.json({ error: "Unknown data view." }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof TypeError || error instanceof ReferenceError) throw error;
    return Response.json(
      { error: "Market readings are not available right now." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
