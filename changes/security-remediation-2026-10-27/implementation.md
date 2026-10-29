---
title: Implementation ledger for developer-portal master
date: 2026-10-27
status: implementation
project: developer-portal
author: frontend-cto
---

# security-remediation-2026-10-27

- Approved scope/spec recorded before source edits.
- D-001: pinned Next 16.4.1 and sharp 0.35.5; clean npm10/Node22 install,
  actual native image policy test and production build passed (exit 0).
- FE-001: removed the network-capable dispatch branch for every public sandbox key.
  Named examples simulate signed events; all other destinations are blocked with
  zero attempts. All IP literals are denied, including normalized mapped/hex forms.
  UI labels simulation/blocked honestly; README documents no outbound delivery.
- Full `npm test` passed: fake accounts/SQLite/libSQL, transaction/wallet safety,
  tenant ledger and zero-egress regressions. No production credentials or RPC signing.
- Native HTTP route suite: 84 checks passed against the compiled server.
- Node 22.21.1 and npm 10.9.4 used; sharp requires Node >=20.9.0.
- Native better-sqlite3 rebuilt only in this isolated worktree.
- CTO skill validation passed; independent QA/Security findings are tracked centrally.
- Local branch: `security/remediation-2026-10-27-master`.
- Delivery evidence and final commit manifest: shared workspace `changes/security-remediation-2026-10-27/tracks/frontend/`.
