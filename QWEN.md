# Project: Thesauros Developer Portal

Next.js account app + developer portal with a built-in sandbox API. On-chain
metrics are read server-side by lib/live-data.mjs; there is no browser-side
proxy to the Partner API. Backend lives in Thesauros/developer.thesauros.io;
on-chain metrics source of truth in Thesauros/thesauros_monitoring_service.

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

## CTO Skill

This project uses the CTO skill at `.cto-skill/`.
- Read `.cto-skill/SKILL.md` and relevant context before implementation.
- Follow `.cto-skill/AGENT_INSTRUCTIONS.md` and use its templates.
- Write durable decisions/context to `.cto-skill/data/`.

## Orchestrator Skill

This project uses the Orchestrator skill at `.orchestrator-skill/`.
- Read `.orchestrator-skill/SKILL.md` and relevant `data/state/` before work.
- Follow its agent instructions and use its handoff templates.
- Update project state after significant events.

## Product Squad Skill

This project uses the Product Squad skill at `.product-squad-skill/`.
- Read its skill instructions and relevant context before defining scope.
- Complete opportunity research or record why it is not applicable before implementation.
- Store the written acceptance criteria and decisions under its `data/`.

## Security Engineer Skill

This project uses the Security Engineer skill at `.security-engineer-skill/`.
- Read its instructions and relevant context before security review.
- Use its templates and preserve evidence in `data/`.
- Current user authorization overrides harness defaults. Commit and network actions
  require applicable authorization; a user prohibition on pushing applies to skill repos too.
