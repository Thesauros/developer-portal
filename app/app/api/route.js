import { randomUUID } from "node:crypto";
import { userSession, accountMode } from "../../../lib/auth.mjs";
import {
  snapshot,
  transact,
  LedgerError,
} from "../../../lib/product-ledger.mjs";
import { withWorkspace } from "../../../lib/workspace-store.mjs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function view(workspace, mode) {
  return { ...snapshot(workspace, mode), funded: !!workspace.funded };
}
export async function GET(request) {
  const session = await userSession(request.headers);
  if (!session)
    return Response.json(
      { error: "Sign in to continue." },
      { status: 401, headers },
    );
  const mode = new URL(request.url).searchParams.get("mode");
  if (mode !== accountMode(session.user))
    return Response.json(
      { error: "This workspace belongs to another account type." },
      { status: 403, headers },
    );
  const data = await withWorkspace(session.user.id, (workspace) =>
    view(workspace, mode),
  );
  return Response.json(data, { headers });
}
export async function POST(request) {
  const session = await userSession(request.headers);
  if (!session)
    return Response.json(
      { error: "Sign in to continue." },
      { status: 401, headers },
    );
  if (!request.headers.get("content-type")?.includes("application/json"))
    return Response.json(
      { error: "JSON is required." },
      { status: 415, headers },
    );
  const origin = request.headers.get("origin");
  if (
    origin &&
    origin !== (process.env.BETTER_AUTH_URL || "http://80.241.220.22:8878")
  )
    return Response.json(
      { error: "Invalid origin." },
      { status: 403, headers },
    );
  try {
    const raw = await request.text();
    if (raw.length > 4096) throw new LedgerError("Request too large.", 413);
    const body = JSON.parse(raw);
    if (body.mode !== accountMode(session.user))
      throw new LedgerError(
        "This workspace belongs to another account type.",
        403,
      );
    const result = await withWorkspace(session.user.id, (workspace) => {
      let event;
      if (body.type === "fund") {
        if (!workspace.funded) {
          const account =
            body.mode === "individual"
              ? workspace.individual
              : workspace.treasury;
          account.cash = 1000000;
          workspace.funded = true;
          event = {
            id: "txn_" + randomUUID(),
            type: "fund",
            amount: 10000,
            at: new Date().toISOString(),
            asset: "USDC",
          };
          account.events.push(event);
        }
      } else event = transact(workspace, body);
      return { event, ...view(workspace, body.mode) };
    });
    return Response.json(result, { status: 201, headers });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof LedgerError
            ? error.message
            : "The request could not be processed.",
      },
      { status: error instanceof LedgerError ? error.status : 400, headers },
    );
  }
}
