import { database } from "../../../lib/auth.mjs";
import { hashPassword } from "better-auth/crypto";
import { createHash, timingSafeEqual } from "node:crypto";
export async function POST(request) {
  const origin = request.headers.get("origin"),
    allowed = process.env.BETTER_AUTH_URL || "http://80.241.220.22:8878";
  if (origin && origin !== allowed)
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const { email, key, password } = await request.json();
    if (
      typeof email !== "string" ||
      email.length > 254 ||
      typeof key !== "string" ||
      key.length > 100 ||
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 128
    )
      return Response.json(
        {
          error:
            "Enter your email, recovery key and a password of at least 12 characters.",
        },
        { status: 400 },
      );
    const normalized = email.trim().toLowerCase(),
      identity = createHash("sha256").update(normalized).digest("hex"),
      now = Date.now();
    const limited = database
      .prepare("SELECT * FROM recovery_limits WHERE identity=?")
      .get(identity);
    if (limited && now - limited.started_at < 600000 && limited.attempts >= 5)
      return Response.json(
        { error: "Too many attempts. Try again in 10 minutes." },
        { status: 429 },
      );
    database
      .prepare(
        "INSERT OR REPLACE INTO recovery_limits(identity,attempts,started_at) VALUES(?,?,?)",
      )
      .run(
        identity,
        limited && now - limited.started_at < 600000 ? limited.attempts + 1 : 1,
        limited && now - limited.started_at < 600000 ? limited.started_at : now,
      );
    const row = database
      .prepare(
        "SELECT user.id,account_recovery.key_hash FROM user JOIN account_recovery ON user.id=account_recovery.user_id WHERE lower(user.email)=?",
      )
      .get(normalized);
    const actual = createHash("sha256")
        .update(key.trim().toLowerCase())
        .digest(),
      expected = Buffer.from(row?.key_hash || "0".repeat(64), "hex");
    if (!row || !timingSafeEqual(actual, expected))
      return Response.json(
        { error: "The email and recovery key do not match." },
        { status: 400 },
      );
    const hashed = await hashPassword(password);
    database.transaction(() => {
      database
        .prepare(
          "UPDATE account SET password=?, updatedAt=? WHERE userId=? AND providerId=?",
        )
        .run(hashed, Date.now(), row.id, "credential");
      database.prepare("DELETE FROM session WHERE userId=?").run(row.id);
      database
        .prepare("DELETE FROM recovery_limits WHERE identity=?")
        .run(identity);
    })();
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Account recovery could not be completed." },
      { status: 400 },
    );
  }
}
