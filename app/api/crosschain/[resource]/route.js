import {
  readCrosschain,
  crosschainPath,
  validateCrosschainResponse,
} from "../../../../lib/crosschain-api.mjs";
import { workspaceSession } from "../../../../lib/auth.mjs";
import { readIndexedActivity } from "../../../../lib/crosschain-history.mjs";
import {
  readCrosschainVault,
  readCrosschainAllocation,
  readCrosschainUser,
} from "../../../../lib/crosschain-reads.mjs";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
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
  }
  try {
    if (!["vault", "allocation", "user", "activity"].includes(resource))
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
      resource === "vault"
        ? await readCrosschainVault()
        : resource === "allocation"
          ? await readCrosschainAllocation()
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
              : await readCrosschain(resource);
    return Response.json(validateCrosschainResponse(resource, value, owner), {
      headers,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error.name === "TimeoutError"
            ? "The cross-chain API timed out."
            : error.message,
      },
      { status: 502, headers },
    );
  }
}
