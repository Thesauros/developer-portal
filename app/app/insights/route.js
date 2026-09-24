import { workspaceSession } from "../../../lib/auth.mjs";
import { accountInsights, marketInsights } from "../../../lib/insights.mjs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request) {
  const session = await workspaceSession(request.headers);
  if (!session)
    return Response.json(
      { error: "Sign in to continue." },
      { status: 401, headers },
    );
  const query = new URL(request.url).searchParams;
  if (query.get("kind") === "account") {
    // An Institution without a linked treasury wallet has no positions yet.
    if (!session.user.walletAddress)
      return Response.json(
        { owner: null, vaults: [], transactions: [] },
        { headers },
      );
    return Response.json(await accountInsights(session.user.walletAddress), {
      headers,
    });
  }
  return Response.json(await marketInsights(query.get("period") || "30d"), {
    headers,
  });
}
