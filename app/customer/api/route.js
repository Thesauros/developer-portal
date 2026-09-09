import { randomUUID } from "node:crypto";
import { database, userSession, accountMode } from "../../../lib/auth.mjs";
import {
  createWorkspace,
  snapshot,
  transact,
  LedgerError,
} from "../../../lib/product-ledger.mjs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function load(user) {
  const row = database
    .prepare("SELECT state FROM product_workspaces WHERE user_id=?")
    .get(user.id);
  const workspace = row
    ? JSON.parse(row.state)
    : createWorkspace(Date.now(), true);
  workspace.replays = new Map(row ? workspace.replays : []);
  return workspace;
}
function save(user, workspace) {
  database
    .prepare(
      "INSERT INTO product_workspaces(user_id,state,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at",
    )
    .run(
      user.id,
      JSON.stringify({ ...workspace, replays: [...workspace.replays] }),
      Date.now(),
    );
}
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
  const data = database.transaction(() => {
    const workspace = load(session.user);
    save(session.user, workspace);
    return view(workspace, mode);
  })();
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
    const result = database.transaction(() => {
      const workspace = load(session.user);
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
      save(session.user, workspace);
      return { event, ...view(workspace, body.mode) };
    })();
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
