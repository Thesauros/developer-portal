import {
  readCrosschain,
  crosschainPath,
  validateCrosschainResponse,
  readCrosschainMoves,
  readCrosschainRates,
} from "../../../../lib/crosschain-api.mjs";
import { workspaceSession } from "../../../../lib/auth.mjs";
import {
  historyCoverage,
  openCrosschainHistory,
  readAcceptedTicks,
  readIndexedActivity,
} from "../../../../lib/crosschain-history.mjs";
import { overLimit, shared } from "../../../../lib/public-guard.mjs";
import {
  readCrosschainVault,
  readCrosschainAllocation,
  readCrosschainUser,
} from "../../../../lib/crosschain-reads.mjs";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function readPrices() {
  const store = openCrosschainHistory();
  try {
    return { ticks: readAcceptedTicks(store), coverage: historyCoverage(store) };
  } finally {
    store.close();
  }
}
export async function GET(request, { params }) {
  const { resource } = await params;
  let owner;
  let ids = [];
  if (resource === "user" || resource === "activity") {
    const session = await workspaceSession(request.headers);
    owner = session?.user?.walletAddress;
    if (!owner)
      return Response.json(
        { error: "Sign in with your wallet." },
        { status: 401, headers },
      );
    const raw = new URL(request.url).searchParams.get("requests") || "";
    if (raw && !/^(?:0|[1-9]\d{0,77})(?:,(?:0|[1-9]\d{0,77})){0,19}$/.test(raw))
      return Response.json(
        { error: "Use at most 20 unsigned request IDs." },
        { status: 400, headers },
      );
    ids = raw ? [...new Set(raw.split(","))] : [];
  } else if (overLimit(request))
    return Response.json(
      { error: "Too many requests." },
      { status: 429, headers },
    );
  try {
    if (
      ![
        "vault",
        "allocation",
        "user",
        "activity",
        "prices",
        "rates",
        "moves",
      ].includes(resource)
    )
      crosschainPath(resource);
  } catch {
    return Response.json(
      { error: "Unknown resource." },
      { status: 404, headers },
    );
  }
  try {
    const history = ["user", "activity"].includes(resource)
      ? readIndexedActivity(owner)
      : null;
    const requestIds = history
      ? [...new Set([...history.requestIds, ...ids])].slice(0, 100)
      : ids;
    const value =
      resource === "rates"
        ? await readCrosschainRates(
            new URL(request.url).searchParams.get("period") || "30d",
          )
        : resource === "moves"
          ? await readCrosschainMoves()
          : resource === "vault"
            ? await shared("crosschain:vault", 15000, readCrosschainVault)
            : resource === "prices"
              ? // Accepted valuations are public; no wallet's events are read here.
                await shared("crosschain:prices", 60000, readPrices)
              : resource === "allocation"
                ? await shared(
                    "crosschain:allocation",
                    30000,
                    readCrosschainAllocation,
                  )
                : resource === "activity"
                  ? history
                  : resource === "user"
                    ? {
                        ...(await readCrosschainUser(owner, requestIds)),
                        coverage: history.coverage,
                        historyScope:
                          "Indexed EpochVault events plus explicitly tracked request IDs",
                        truncated:
                          history.truncated || history.requestIds.length > 100,
                      }
                    : await shared("crosschain:" + resource, 30000, () =>
                        readCrosschain(resource),
                      );
    return Response.json(validateCrosschainResponse(resource, value, owner), {
      headers,
    });
  } catch (error) {
    // An RPC error can carry its URL, and a keyed URL must not reach the page.
    console.error("crosschain " + resource + ":", error.message);
    return Response.json(
      {
        error:
          error.name === "TimeoutError"
            ? "The data source timed out."
            : "This data is not available right now.",
      },
      { status: 502, headers },
    );
  }
}
