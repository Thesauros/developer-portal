<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## CTO Skill

This project uses the CTO skill at `.cto-skill/`.

- Treat `.cto-skill/SKILL.md` as the primary CTO instruction surface.
- Use `.cto-skill/references/repository-harness.md` for persistent memory rules.
- Store durable CTO knowledge under `.cto-skill/data/`; keep entries concise and dated.
- Do not store secrets, credentials or environment dumps.
- Validate with `node .cto-skill/bin/cto-skill.mjs validate` before committing.
- Follow the Product → CTO → QA → Security pipeline, tracked by Orchestrator.
- Current user authorization overrides harness network defaults, including pulls and pushes.
