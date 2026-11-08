import { overLimit, shared } from "../../../../lib/public-guard.mjs";
import { publicFeed, readHistoryBundle } from "../../../../lib/vault-feed.mjs";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "public, max-age=30" };
const failed = { "Cache-Control": "no-store" };

// Public vault history: share prices, sizes and the record of moves. Nothing here
// names a wallet, and account data stays behind the session routes.
export async function GET(request, { params }) {
  const { resource } = await params;
  if (!["history", "feed"].includes(resource))
    return Response.json({ error: "Unknown resource." }, { status: 404, headers: failed });
  if (overLimit(request))
    return Response.json({ error: "Too many requests." }, { status: 429, headers: failed });
  try {
    const value =
      resource === "history"
        ? await shared("vaults:history", 60000, async () => {
            const { ticks, samples, index, indexes, markets } = readHistoryBundle();
            return { ticks, samples, index, indexes, markets };
          })
        : await shared("vaults:feed", 120000, publicFeed);
    return Response.json(value, { headers });
  } catch (error) {
    console.error("vault " + resource + ":", error.message);
    return Response.json(
      { error: "This history is not available right now." },
      { status: 503, headers: failed },
    );
  }
}
