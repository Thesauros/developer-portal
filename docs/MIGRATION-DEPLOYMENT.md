# Migration release on app-v2-dev

The manual release entry point deploys only `Thesauros/developer-portal` branch
`migration` to <https://app-v2-dev.thesauros.io/app/>. It leaves GitHub Actions,
the installed OIDC policy and unrelated application processes unchanged.

Run tests and the production build before pushing. After pushing `migration`,
pass its full 40-character commit SHA to the release script from the reviewed
checkout:

```bash
/opt/node-v24.21.0-linux-x64/bin/node --test test/deploy-migration.mjs
/opt/node-v24.21.0-linux-x64/bin/node deploy/automation/release-migration.mjs FULL_COMMIT_SHA
```

The script takes `/var/lib/thesauros-portal-v2/deploy.lock` itself; do not wrap it
in another `flock` for the same lock. The lock stays held across fetch, build,
candidate verification and activation. Another deployment fails without changing
the running application. Deployment requires server filesystem/network privileges.

The source cache is `/root/developer-portal-v2`. The script fetches only the exact
`refs/heads/migration`, checks its SHA before and after fetch, after build, and
immediately before activation. It never checks out or edits that cache's files.
It extracts the pinned commit into a new directory under
`/var/lib/thesauros-portal-v2/releases/`, installs dependencies and builds with the
pinned Node 24.21.0. A moved or missing remote branch aborts the release.

Production settings remain in `/var/lib/thesauros-portal-v2/runtime.env` and
accounts remain in `/var/lib/thesauros-portal-v2/accounts.sqlite`. Build-time
accounts and cross-chain history use separate databases inside the new release.
The release checks the exact public origin and account path and rejects a remote
Turso database or unexpected Next build directory. It backs up accounts with the
SQLite backup API before initializing the additive schema. Rollback restores the
application; it never restores a database snapshot over newer user writes.

Each release contains a read-only `.portal-release.json` with branch, commit,
source tree and origin, and a read-only `.portal-build.json` recording the same
provenance and Next build ID. `/api/version` reads the release-local marker and
returns **only** `branch` and `sha` with `Cache-Control: no-store`. Production
returns 503 for a missing or invalid marker; development returns a development
marker with no commit. Do not create a marker in the source checkout to simulate
a successful release.

The candidate runs on `127.0.0.1:18881`. Checks cover wallet entry, a served
JavaScript asset, the unauthenticated session and protected workspace API, and
the exact candidate branch/SHA. Activation recreates only PM2
`developer-portal-v2` on `127.0.0.1:18880`, then checks both localhost and the
actual HTTPS domain. It then starts the dedicated migration history worker and
requires a fresh confirmed-block cursor. A failed activation restores the previous
web release and migration worker, or removes the new worker when none existed.
PM2 state and `current.json` persist only after both services pass their checks.
All older releases and unrelated files are retained.

After success compare:

```bash
git ls-remote --heads origin refs/heads/migration
curl --fail https://app-v2-dev.thesauros.io/api/version
cat /var/lib/thesauros-portal-v2/current.json
```

The SHA and branch must match. Check that PM2 `developer-portal-v2` uses the
`current.json` release directory, and verify `/app/` and its current JavaScript
assets through the public domain.

## Cross-chain history worker

EpochVault request/claim history requires `scripts/index-crosschain.mjs` in
addition to the web process. The release manages exactly one PM2 worker named
`developer-portal-migration-indexer`, using the deployed release directory, pinned
Node 24 and `--env-file=.env.local`. The symlink resolves to the same private
runtime settings as the web application. Both services explicitly use
`/var/lib/thesauros-portal-v2/history.sqlite`; a different runtime
`CROSSCHAIN_HISTORY_DB` aborts deployment. Unexpected or duplicate workers with
this name also abort; no other indexer or container is stopped or replaced.

If the target event index does not exist, the release can seed it from
`/var/lib/docker/volumes/deploy_crosschain-accounts/_data/history.sqlite`, the
existing cross-chain site's mounted history DB. This source was inspected via
Docker mounts and SQLite metadata. The source is opened read-only, its exact
chain/vault/accountant/deployment-block identity must match the deployed code,
and the SQLite backup API creates a consistent snapshot. Exclusive publication
prevents overwriting an existing target. Only the rebuildable event index is
copied; the source account database and worker remain untouched. If no source
exists, the new worker backfills from the deployment block. An existing target
with a mismatched identity aborts instead of being overwritten.

The worker starts after candidate validation and web activation. Successful
activation requires an online singleton in the correct release and a successful
history cursor update after worker startup. Complete historical coverage is not
required: incomplete coverage remains visibly incomplete while backfill runs.
The worker is saved with PM2 for restart after boot. Rollback restores the
previous migration worker's release and running/stopped state; it retains history
already indexed and never rewinds user account data.

Inspect `pm2 status developer-portal-migration-indexer` and its cursor/error
metadata after deployment. The index is rebuildable; the account database is
persistent user data and must be preserved.
See [CROSSCHAIN-STAND.md](CROSSCHAIN-STAND.md) for indexer coverage and reorg rules.
