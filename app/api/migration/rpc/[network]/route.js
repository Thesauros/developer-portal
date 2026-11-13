import { workspaceSession } from "../../../../../lib/auth.mjs";
import { handleMigrationRpc } from "../../../../../lib/migration-rpc.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, { params }) {
  const { network } = await params;
  const session = await workspaceSession(request.headers);
  return handleMigrationRpc(request, { network, session });
}
