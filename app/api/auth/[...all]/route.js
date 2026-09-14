import { toNextJsHandler } from "better-auth/next-js";
import { createHash } from "node:crypto";
import { parseSiweMessage } from "viem/siwe";
import { auth, authOrigin } from "../../../../lib/auth.mjs";
const handlers = toNextJsHandler(auth);
const nonceCookie = "thesauros.wallet-challenge";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const noStore = { "Cache-Control": "private, no-store" };
function externalRequest(request) {
  const url = new URL(request.url),
    prefix = process.env.NEXT_PUBLIC_BASE_PATH || "";
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
function challengeHeader(value, age) {
  return `${nonceCookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${authOrigin.startsWith("https:") ? "; Secure" : ""}`;
}
export const GET = (request) => handlers.GET(externalRequest(request));
export async function POST(request) {
  const path = new URL(request.url).pathname.split("/api/auth")[1];
  if (
    !["/siwe/nonce", "/siwe/get-nonce", "/siwe/verify", "/sign-out"].includes(
      path,
    )
  )
    return Response.json(
      {
        message:
          "Connect a wallet to access Individual. Institution is coming soon.",
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
  const response = await handlers.POST(externalRequest(request));
  response.headers.set("Cache-Control", "private, no-store");
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
