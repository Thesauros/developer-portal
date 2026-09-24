import { hashPassword } from "better-auth/crypto";
import { createHash, timingSafeEqual } from "node:crypto";
import { authOrigin, dbAll, dbRun } from "../../../lib/auth.mjs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (error, status = 400) =>
  Response.json({ error }, { status, headers });

// Institution password reset with the recovery key issued at sign-up.
// Individual accounts use wallet sign-in and have nothing to recover.
export async function POST(request) {
  if (request.headers.get("origin") !== authOrigin)
    return fail("Invalid request origin.", 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request.");
  }
  const { email, key, password } = body || {};
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    typeof key !== "string" ||
    key.length > 100 ||
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    return fail(
      "Enter your email, recovery key and a new password of at least 12 characters.",
    );
  const normalized = email.trim().toLowerCase();
  const identity = createHash("sha256").update(normalized).digest("hex");
  const now = Date.now();
  const [limited] = await dbAll(
    "SELECT attempts, started_at FROM recovery_limits WHERE identity=?",
    [identity],
  );
  const recent = limited && now - Number(limited.started_at) < 600000;
  if (recent && Number(limited.attempts) >= 5)
    return fail("Too many attempts. Try again in 10 minutes.", 429);
  await dbRun(
    "INSERT OR REPLACE INTO recovery_limits(identity,attempts,started_at) VALUES(?,?,?)",
    [
      identity,
      recent ? Number(limited.attempts) + 1 : 1,
      recent ? Number(limited.started_at) : now,
    ],
  );
  const [row] = await dbAll(
    "SELECT user.id, account_recovery.key_hash FROM user JOIN account_recovery ON user.id=account_recovery.user_id WHERE lower(user.email)=? AND user.accountType='institution'",
    [normalized],
  );
  const actual = createHash("sha256").update(key.trim().toLowerCase()).digest();
  const expected = Buffer.from(row?.key_hash || "0".repeat(64), "hex");
  if (!row || !timingSafeEqual(actual, expected))
    return fail("The email and recovery key do not match.");
  const hashed = await hashPassword(password);
  await dbRun(
    "UPDATE account SET password=?, updatedAt=? WHERE userId=? AND providerId='credential'",
    [hashed, new Date(now).toISOString(), row.id],
  );
  await dbRun("DELETE FROM session WHERE userId=?", [row.id]);
  await dbRun("DELETE FROM recovery_limits WHERE identity=?", [identity]);
  return Response.json({ ok: true }, { headers });
}
