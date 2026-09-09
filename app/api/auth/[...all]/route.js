import { toNextJsHandler } from "better-auth/next-js";
import { auth, database } from "../../../../lib/auth.mjs";
import { randomBytes, createHash } from "node:crypto";
const handlers = toNextJsHandler(auth);
// Next normalizes the configured basePath out of the route request URL.
// Better Auth matches against its externally visible basePath.
function externalRequest(request) {
  const url = new URL(request.url);
  const prefix = process.env.NEXT_PUBLIC_BASE_PATH || "";
  if (prefix && !url.pathname.startsWith(prefix + "/"))
    url.pathname = prefix + url.pathname;
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    ...(!["GET", "HEAD"].includes(request.method)
      ? { body: request.body, duplex: "half" }
      : {}),
  });
}
export const GET = (request) => handlers.GET(externalRequest(request));
export async function POST(request) {
  const signup = new URL(request.url).pathname.endsWith("/sign-up/email");
  let accountDetails;
  if (signup) {
    try {
      const body = await request.clone().json();
      if (
        !["individual", "institution"].includes(body.accountType) ||
        typeof body.name !== "string" ||
        body.name.trim().length < 2 ||
        body.name.length > 100 ||
        typeof body.company !== "string" ||
        body.company.length > 120 ||
        (body.accountType === "institution" && body.company.trim().length < 2)
      )
        return Response.json(
          { message: "Enter your name and account details." },
          { status: 400 },
        );
      accountDetails = {
        accountType: body.accountType,
        company: body.company.trim(),
      };
    } catch {
      return Response.json(
        { message: "Check the submitted details." },
        { status: 400 },
      );
    }
  }
  const response = await handlers.POST(externalRequest(request));
  if (signup && response.ok) {
    const body = await response.clone().json();
    if (
      body.user?.id &&
      body.token &&
      database.prepare("SELECT id FROM user WHERE id=?").get(body.user.id) &&
      !database
        .prepare("SELECT user_id FROM account_recovery WHERE user_id=?")
        .get(body.user.id)
    ) {
      const key = randomBytes(24)
        .toString("hex")
        .match(/.{1,8}/g)
        .join("-");
      database.transaction(() => {
        database
          .prepare("UPDATE user SET accountType=?,company=? WHERE id=?")
          .run(
            accountDetails.accountType,
            accountDetails.company,
            body.user.id,
          );
        database
          .prepare(
            "INSERT OR REPLACE INTO account_recovery(user_id,key_hash) VALUES(?,?)",
          )
          .run(body.user.id, createHash("sha256").update(key).digest("hex"));
      })();
      return Response.json(
        {
          ...body,
          user: { ...body.user, ...accountDetails },
          recoveryKey: key,
        },
        { status: response.status, headers: response.headers },
      );
    }
  }
  return response;
}
