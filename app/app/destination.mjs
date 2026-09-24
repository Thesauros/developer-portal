// The server route selects a workspace view, not an authorization role. Both
// views use the verified wallet identity; API authorization remains server-side.
export function workspaceDestination(
  mode,
  { next = "", hash = "", pathname = "", fallback = "overview" } = {},
) {
  const view = mode === "institution" ? "institution" : "individual";
  const allowed = [
    "overview",
    "vaults",
    "activity",
    "earn",
    "markets",
    "developers",
    "settings",
  ];
  // Views merged into Vaults in the 2026-09 workspace redesign.
  const vaultViews = [
    "performance",
    "operations",
    "protocol",
    "events",
    "analytics",
    "status",
  ];
  const technical = [
    "quickstart",
    "reference",
    "keys",
    "webhooks",
    "usage",
    "reconciliation",
    "users",
  ];
  let tab = fallback;
  const requested = /^\/app\/(?:individual|institution)(?:#([a-z/]+))?$/.exec(
    next,
  );
  if (requested?.[1]) tab = requested[1];
  const fragment = hash.replace(/^#/, "");
  if (
    allowed.includes(fragment) ||
    vaultViews.includes(fragment) ||
    ["build", "customers"].includes(fragment) ||
    fragment.startsWith("integrations")
  )
    tab = fragment;
  if (pathname.startsWith("/developers") && technical.includes(fragment))
    tab = "developers";
  if (vaultViews.includes(tab)) tab = "vaults";
  // The test-funds sandbox was removed in 2026-09; old links open Portfolio.
  if (tab === "test") tab = "overview";
  if (pathname.startsWith("/monitoring")) tab = "vaults";
  // Legacy console links land in the unified Developers center.
  if (tab === "customers" || tab.startsWith("integrations")) tab = "developers";
  if (tab === "build") tab = "developers";
  if (!allowed.includes(tab)) tab = "overview";
  return "/app/" + view + (tab === "overview" ? "" : "#" + tab);
}
