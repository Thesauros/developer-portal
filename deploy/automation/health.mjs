export async function checkApplication(
  local,
  { legacy = false, fetcher = fetch } = {},
) {
  const prefix = legacy ? "/developers" : "";
  const entry = legacy ? prefix + "/customer" : "/app";
  const options = () => ({
    headers: { Host: "app-v2-dev.thesauros.io", "X-Forwarded-Proto": "https" },
    signal: AbortSignal.timeout(5000),
  });
  const page = await fetcher(local + entry, options());
  if (page.status !== 200) throw new Error("Sign-in page is not healthy");
  const html = await page.text();
  if (
    !html.includes("Your wallet.") &&
    !(legacy && html.includes("Welcome back."))
  )
    throw new Error("Sign-in page content is missing");
  const asset = html.match(/src="([^" ]*\/_next\/static\/[^" ]+\.js)"/);
  if (
    !asset ||
    !asset[1].startsWith(prefix + "/_next/") ||
    !(await fetcher(local + asset[1], options())).ok
  )
    throw new Error("Application assets are not healthy");
  const session = await fetcher(
    local + prefix + "/api/auth/get-session",
    options(),
  );
  if (session.status !== 200 || (await session.json()) !== null)
    throw new Error("Session endpoint is not healthy");
  const workspace = await fetcher(
    local + entry + "/api?mode=individual",
    options(),
  );
  if (workspace.status !== 401)
    throw new Error("Workspace authentication check failed");
}
