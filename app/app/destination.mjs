// Only known local tabs can become a post-auth destination. Account role is
// supplied by the server/auth response, never trusted from the requested URL.
export function workspaceDestination(mode, { next = "", hash = "", pathname = "", fallback = "overview" } = {}) {
  const role = mode === "institution" ? "institution" : "individual";
  const technical = ["quickstart", "reference", "keys", "webhooks", "usage", "reconciliation", "users"];
  const common = ["overview", "protocol", "markets", "activity", "test", "settings"];
  const allowed = role === "institution" ? [...common, "customers", "integrations", ...technical.map(id => "integrations/" + id)] : common;
  let tab = fallback;
  const requested = /^\/app\/(?:individual|institution)(?:#([a-z/]+))?$/.exec(next);
  if (requested?.[1]) tab = requested[1];
  const fragment = hash.replace(/^#/, "");
  if (allowed.includes(fragment)) tab = fragment;
  if (pathname.startsWith("/developers") && technical.includes(fragment)) tab = "integrations/" + fragment;
  if (["analytics", "vaults", "status"].includes(fragment) || pathname.startsWith("/monitoring")) tab = "protocol";
  if (role === "individual" && (tab === "customers" || tab.startsWith("integrations"))) tab = "protocol";
  if (!allowed.includes(tab)) tab = "overview";
  return "/app/" + role + (tab === "overview" ? "" : "#" + tab);
}
