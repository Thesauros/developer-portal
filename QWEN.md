# Project: Thesauros Developer Portal

Next.js developer portal + built-in sandbox API. Real-data mode proxies the
Partner API (/api/v1/real/*) and the monitoring service (/api/v1/monitor/*).
Backend lives in Thesauros/developer.thesauros.io; on-chain metrics source of
truth in Thesauros/thesauros_monitoring_service.

## Agent skills (always active)

Six living-memory skill repos are cloned in this project. Before substantive
work, read the relevant SKILL.md / AGENT_INSTRUCTIONS.md and the project
entries under `<skill>/data/context/`:

- `.cto-skill/` — implements (architecture, code decisions)
- `.qa-skill/` — verifies against spec, logs defects, gates PASS/FAIL
- `.product-squad-skill/` — validates business/functional fit (SDD discovery)
- `.security-engineer-skill/` — enterprise security review (can block release)
- `.orchestrator-skill/` — sequencing, handoffs, state
- `.biz-dev-skill/` — outreach/partner collateral facts

Harness convention: pull each skill before work, push after every
significant data write (founder pre-approved immediate pushes for skill
repos on 2026-08-11). Pushes to product repos (this one, backend) require
explicit founder approval per push batch.
