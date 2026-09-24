import { getAddress, isAddress } from "viem";
import { hashPassword } from "better-auth/crypto";
import { createHash, randomBytes } from "node:crypto";
import {
  auth,
  authOrigin,
  dbAll,
  dbRun,
  institutionSession,
} from "../../../lib/auth.mjs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (error, status = 400) =>
  Response.json({ error }, { status, headers });

// Institution account actions:
// - join: a wallet user who signed in from the Institution page
// - wallet: link or remove the treasury wallet the workspace tracks
// - email: add a work email, optionally with a password for email sign-in
// - skip-email: dismiss the email step after wallet sign-in
export async function POST(request) {
  if (request.headers.get("origin") !== authOrigin)
    return fail("Invalid origin.", 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request.");
  }
  const action = body?.action || ("address" in (body || {}) ? "wallet" : "");

  if (action === "join") {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return fail("Sign in with your wallet first.", 401);
    const [wallet] = await dbAll(
      "SELECT address FROM walletAddress WHERE userId=? AND isPrimary=1",
      [session.user.id],
    );
    if (!wallet) return fail("Sign in with your wallet first.", 401);
    await dbRun("UPDATE user SET accountType='institution' WHERE id=?", [
      session.user.id,
    ]);
    return Response.json({ ok: true }, { headers });
  }

  const session = await institutionSession(request.headers);
  if (!session) return fail("Sign in to your Institution account.", 401);
  const userId = session.user.id;

  if (action === "wallet") {
    if (body.address === null) {
      await dbRun("DELETE FROM treasury_wallets WHERE user_id=?", [userId]);
      return Response.json({ address: null }, { headers });
    }
    if (typeof body.address !== "string" || !isAddress(body.address.trim()))
      return fail("Enter a valid wallet address starting with 0x.");
    const address = getAddress(body.address.trim());
    await dbRun(
      "INSERT OR REPLACE INTO treasury_wallets(user_id,address,updated_at) VALUES(?,?,?)",
      [userId, address, Date.now()],
    );
    return Response.json({ address }, { headers });
  }

  if (action === "skip-email") {
    await dbRun(
      "INSERT OR REPLACE INTO profile_flags(user_id,email_prompt_dismissed) VALUES(?,1)",
      [userId],
    );
    return Response.json({ ok: true }, { headers });
  }

  if (action === "email") {
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const company = typeof body.company === "string" ? body.company.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254)
      return fail("Enter a valid work email.");
    if (company.length > 120) return fail("Company name is too long.");
    if (password && (password.length < 12 || password.length > 128))
      return fail("Use a password of 12 to 128 characters.");
    const [taken] = await dbAll(
      "SELECT id FROM user WHERE lower(email)=? AND id<>?",
      [email, userId],
    );
    if (taken) return fail("This email is already used by another account.");
    const now = new Date().toISOString();
    await dbRun(
      "UPDATE user SET email=?, company=CASE WHEN ?<>'' THEN ? ELSE company END, updatedAt=? WHERE id=?",
      [email, company, company, now, userId],
    );
    let recoveryKey = null;
    if (password && !session.user.hasPassword) {
      await dbRun(
        "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)",
        [
          randomBytes(16).toString("hex"),
          userId,
          "credential",
          userId,
          await hashPassword(password),
          now,
          now,
        ],
      );
      recoveryKey = randomBytes(24)
        .toString("hex")
        .match(/.{1,8}/g)
        .join("-");
      await dbRun(
        "INSERT OR REPLACE INTO account_recovery(user_id,key_hash) VALUES(?,?)",
        [userId, createHash("sha256").update(recoveryKey).digest("hex")],
      );
    }
    await dbRun(
      "INSERT OR REPLACE INTO profile_flags(user_id,email_prompt_dismissed) VALUES(?,1)",
      [userId],
    );
    return Response.json({ ok: true, email, recoveryKey }, { headers });
  }

  return fail("Unknown action.");
}
