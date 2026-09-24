import assert from "node:assert/strict";
import { workspaceDestination as destination } from "../app/app/destination.mjs";
assert.equal(destination("institution"), "/app/institution");
assert.equal(
  destination("institution", { hash: "#events" }),
  "/app/institution#vaults",
);
assert.equal(
  destination("institution", { next: "/app/institution#build" }),
  "/app/institution#developers",
);
assert.equal(
  destination("institution", { pathname: "/monitoring" }),
  "/app/institution#vaults",
);
assert.equal(
  destination("institution", { pathname: "/developers", hash: "#reference" }),
  "/app/institution#developers",
);
assert.equal(
  destination("institution", { hash: "#integrations/keys" }),
  "/app/institution#developers",
);
assert.equal(
  destination("institution", {
    next: "https://example.invalid/app/institution#settings",
  }),
  "/app/institution",
);
assert.equal(
  destination("individual", { next: "/app/institution#vaults" }),
  "/app/individual#vaults",
);
assert.equal(
  destination("individual", { hash: "#build" }),
  "/app/individual#developers",
);
assert.equal(destination("admin", { hash: "#unknown" }), "/app/individual");
for (const legacy of ["performance", "operations", "protocol", "events"])
  assert.equal(
    destination("individual", { hash: "#" + legacy }),
    "/app/individual#vaults",
  );
for (const tab of ["vaults", "activity", "earn", "developers"]) {
  assert.equal(
    destination("institution", { hash: "#" + tab }),
    "/app/institution#" + tab,
  );
  assert.equal(
    destination("individual", { next: "/app/institution#" + tab }),
    "/app/individual#" + tab,
  );
}
console.log(
  "Wallet workspace destinations: 18 checks passed. View selection cannot redirect outside the app.",
);
