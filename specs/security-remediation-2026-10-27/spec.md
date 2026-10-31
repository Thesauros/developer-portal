---
title: Reviewed security remediation for developer-portal master
date: 2026-10-27
status: approved-for-local-implementation
project: developer-portal
author: product-cto-security
---

# Change: security-remediation-2026-10-27

Baseline: `master`. Findings: D-001, FE-001. The approved workspace scope and opportunity framing are in `specs/security-remediation-2026-10-27/` at the shared Thesauros workspace root. Use the existing workspace five-role skill pipeline and project AGENTS instructions; this worktree is an isolated branch of the existing project.

- D-001: keep the existing Next major line (16 for apps/portal/monitor/dashboard, 15 for landing), move to vendor-patched Next >=16.4.1 or >=15.5.28 and sharp >=0.35.5 in the real package-manager lock. Preserve wallet libraries and validate clean installation/build plus a dependency-policy check.
- FE-001: this portal API is a public synthetic sandbox. Never perform a real outbound webhook request for any URL/key. Keep documented example-host simulation, record other endpoints as blocked, and reject unsafe literal/hostname inputs. Real partner delivery remains owned by the separately authenticated developer API. Assert zero fetch calls for public/private/DNS targets.

No production environment files, real credentials, wallet broadcasts, public webhook receivers, deployments or pushes. Commit local changes on `security/remediation-2026-10-27-master`. Original branches/worktrees remain intact. QA/Security independently verify behavior after implementation; the user receives branch/commit and remaining deployment checks before merge/release.
