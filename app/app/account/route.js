import { getAddress, isAddress } from "viem";
import { authOrigin, dbRun, institutionSession } from "../../../lib/auth.mjs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

// Institution treasury wallet: the address whose Earn positions the
// workspace reads. Linking is watch-only; transactions still need the wallet.
export async function POST(request) {
  const session = await institutionSession(request.headers);
  if (!session)
    return Response.json(
      { error: "Sign in to your Institution account." },
      { status: 401, headers },
    );
  if (request.headers.get("origin") !== authOrigin)
    return Response.json(
      { error: "Invalid origin." },
      { status: 403, headers },
    );
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid request." },
      { status: 400, headers },
    );
  }
  if (body?.address === null) {
    await dbRun("DELETE FROM treasury_wallets WHERE user_id=?", [
      session.user.id,
    ]);
    return Response.json({ address: null }, { headers });
  }
  if (typeof body?.address !== "string" || !isAddress(body.address.trim()))
    return Response.json(
      { error: "Enter a valid wallet address starting with 0x." },
      { status: 400, headers },
    );
  const address = getAddress(body.address.trim());
  await dbRun(
    "INSERT OR REPLACE INTO treasury_wallets(user_id,address,updated_at) VALUES(?,?,?)",
    [session.user.id, address, Date.now()],
  );
  return Response.json({ address }, { headers });
}
