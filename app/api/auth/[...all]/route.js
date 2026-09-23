import { toNextJsHandler } from "better-auth/next-js";
import { createHash, randomBytes } from "node:crypto";
import { parseSiweMessage } from "viem/siwe";
import { auth, authOrigin, dbAll, dbRun } from "../../../../lib/auth.mjs";
const handlers = toNextJsHandler(auth);
const nonceCookie = "thesauros.wallet-challenge";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const noStore = { "Cache-Control": "private, no-store" };
function challengeHeader(value, age) {
  return `${nonceCookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${authOrigin.startsWith("https:") ? "; Secure" : ""}`;
}
export const GET = (request) => handlers.GET(request);
export async function POST(request) {
  const path = new URL(request.url).pathname.split("/api/auth")[1];
  if (
    ![
      "/siwe/nonce",
      "/siwe/get-nonce",
      "/siwe/verify",
      "/sign-out",
      "/sign-in/email",
      "/sign-up/email",
      "/change-password",
      "/revoke-other-sessions",
    ].includes(path)
  )
    return Response.json(
      {
        message: "Connect a wallet to access your Thesauros workspace.",
      },
      { status: 410, headers: noStore },
    );
  if (request.headers.get("origin") !== authOrigin)
    return Response.json(
      { message: "Invalid origin." },
      { status: 403, headers: noStore },
    );
  if (!request.headers.get("content-type")?.includes("application/json"))
    return Response.json(
      { message: "JSON is required." },
      { status: 415, headers: noStore },
    );
  let body;
  try {
    const raw = await request.clone().text();
    if (raw.length > 16_384)
      return Response.json(
        { message: "Request too large." },
        { status: 413, headers: noStore },
      );
    body = JSON.parse(raw);
  } catch {
    return Response.json(
      { message: "Invalid request." },
      { status: 400, headers: noStore },
    );
  }
  if (path === "/siwe/verify") {
    const cookie = request.headers
      .get("cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(nonceCookie + "="))
      ?.slice(nonceCookie.length + 1);
    let nonce;
    try {
      nonce = parseSiweMessage(body.message).nonce;
    } catch {}
    if (!nonce || !cookie || digest(nonce) !== cookie)
      return Response.json(
        { message: "This sign-in request expired. Please connect again." },
        { status: 401, headers: noStore },
      );
  }
  if (path === "/sign-up/email") return institutionSignUp(request, body);
  const response = await handlers.POST(request);
  response.headers.set("Cache-Control", "private, no-store");
  if (path === "/sign-in/email" && response.ok) {
    // Email access is for Institution accounts only.
    const result = await response.clone().json();
    const rows = await dbAll("SELECT accountType FROM user WHERE id=?", [
      result.user?.id,
    ]);
    if (rows[0]?.accountType !== "institution") {
      if (result.token)
        await dbRun("DELETE FROM session WHERE token=?", [result.token]);
      return Response.json(
        {
          message:
            "This email is not an Institution account. Individual accounts sign in with a wallet.",
        },
        { status: 403, headers: noStore },
      );
    }
    // Keep the session token in the HttpOnly cookie only.
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(
      JSON.stringify({
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
        },
      }),
      { status: 200, headers },
    );
  }
  if (response.ok && ["/siwe/nonce", "/siwe/get-nonce"].includes(path)) {
    const result = await response.clone().json();
    response.headers.append(
      "Set-Cookie",
      challengeHeader(digest(result.nonce), 300),
    );
  }
  if (path === "/siwe/verify" || path === "/sign-out")
    response.headers.append("Set-Cookie", challengeHeader("", 0));
  if (path === "/siwe/verify" && response.ok) {
    const result = await response.json();
    return Response.json(
      { success: true, user: result.user },
      { headers: response.headers },
    );
  }
  return response;
}

// Institution sign-up: name, company, email, password. Returns a one-time
// recovery key, the only way to reset a password without email delivery.
async function institutionSignUp(request, body) {
  const text = (v, max) =>
    typeof v === "string" && v.trim().length >= 2 && v.length <= max;
  if (
    !text(body.name, 100) ||
    !text(body.company, 120) ||
    typeof body.email !== "string" ||
    body.email.length > 254 ||
    typeof body.password !== "string"
  )
    return Response.json(
      { message: "Enter your name, company, work email and a password." },
      { status: 400, headers: noStore },
    );
  const forwarded = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({
      name: body.name.trim(),
      email: body.email.trim().toLowerCase(),
      password: body.password,
    }),
  });
  const response = await handlers.POST(forwarded);
  if (!response.ok) {
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const result = await response.clone().json();
  const key = randomBytes(24)
    .toString("hex")
    .match(/.{1,8}/g)
    .join("-");
  await dbRun("UPDATE user SET accountType=?, company=? WHERE id=?", [
    "institution",
    body.company.trim(),
    result.user.id,
  ]);
  await dbRun(
    "INSERT OR REPLACE INTO account_recovery(user_id,key_hash) VALUES(?,?)",
    [result.user.id, digest(key)],
  );
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.delete("content-length");
  return new Response(
    JSON.stringify({
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
      },
      recoveryKey: key,
    }),
    { status: 200, headers },
  );
}
