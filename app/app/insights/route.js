import { workspaceSession } from "../../../lib/auth.mjs";
import { accountInsights, marketInsights } from "../../../lib/insights.mjs";
import { refreshVaultEvents } from "../../../lib/vault-events.mjs";
import { overLimit, shared } from "../../../lib/public-guard.mjs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request) {
  const query = new URL(request.url).searchParams;
  // Vault rates and allocation are public. Anything about a wallet is not.
  if (query.get("kind") !== "account") {
    if (overLimit(request))
      return Response.json(
        { error: "Too many requests." },
        { status: 429, headers },
      );
    const period = query.get("period") || "30d";
    return Response.json(
      await shared("insights:" + period, 60000, () => marketInsights(period)),
      { headers },
    );
  }
  const session = await workspaceSession(request.headers);
  if (!session)
    return Response.json(
      { error: "Sign in to continue." },
      { status: 401, headers },
    );
  if (query.get("kind") === "account") {
    // An Institution without a linked treasury wallet has no positions yet.
    if (!session.user.walletAddress)
      return Response.json(
        { owner: null, vaults: [], transactions: [] },
        { headers },
      );
    if (query.get("fresh") === "1")
      await refreshVaultEvents(["arbitrum", "base", "monad", "plasma"]);
    return Response.json(await accountInsights(session.user.walletAddress), {
      headers,
    });
  }
  return Response.json(await marketInsights(query.get("period") || "30d"), {
    headers,
  });
}
