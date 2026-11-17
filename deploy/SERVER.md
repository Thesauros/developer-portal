# app-v2-dev.thesauros.io deployment

A push to `migration` runs the `Account app` workflow. After tests, the production
build, route checks and deployment tests pass, `Deploy app-v2-dev` requests the
same commit on <https://app-v2-dev.thesauros.io/app/>. Pull requests and other
branches never deploy. Manual dispatch is allowed only with `migration` selected.

## Authentication and transport

The deploy job alone receives `id-token: write`. It obtains a short-lived GitHub
OIDC token; GitHub stores no application secrets or deployment password. The
server verifies GitHub's RS256 signature, issuer, audience, token age and validity,
immutable repository/owner IDs, exact repository, `refs/heads/migration`, exact
`web.yml` workflow at the same SHA, push/dispatch event and GitHub-hosted runner.
Forks, PRs, tags, `v2`, other branches and other workflows are rejected.

`POST /__deploy/v2` starts a run; authenticated `GET` reports that run's state.
The existing endpoint name identifies the app-v2-dev transport, not permission
to deploy the obsolete Git branch `v2`. Keep this path and OIDC audience together;
no nginx change is needed. Responses bind both branch and SHA. Repeated requests
for the same run/attempt cannot start another release. Failed runs can be retried
with a new GitHub workflow attempt. Tokens and private runtime values are never
returned in status responses or written to logs.

## Release process

Both automated and manual releases use `release-migration.mjs`. The HTTP service
runs it with Node 24 under a 20-minute process timeout, without an outer `flock`.
The runner itself exclusively holds `/var/lib/thesauros-portal-v2/deploy.lock`.

1. Verify the allowed repository and exact remote `migration` head; fetch that
   ref into the source cache and verify the immutable commit again.
2. Extract the commit into a new release. Preserve runtime settings, accounts
   and history outside releases; use isolated account/history databases to build.
3. Install dependencies, initialize the isolated schema and build Next.js. An
   ordinary build error fails. Only exit 1 with the exact fresh security/build
   receipt emitted by Next during this attempt permits one identical retry in
   the same directory. The advisory remains visible; no bypass flag or dependency
   change is applied. A failed retry also fails the release.
4. Recheck the remote head after build and immediately before activation. A
   moved branch fails closed; it cannot activate a stale candidate.
5. Back up accounts consistently with SQLite's backup API, then initialize the
   additive schema. Validate the contract identity of the persistent history.
6. Check a candidate on `127.0.0.1:18881`: wallet entry or the public Earn shell,
   expected entry redirect, served JavaScript, null guest session, protected
   account API, and `/api/version` with the exact branch/SHA.
7. Switch PM2 `developer-portal-v2` on port 18880; verify localhost and the real
   HTTPS domain. Start exactly one dedicated migration history worker from the
   same release, and require a fresh successful cursor update.
8. Save PM2 and `current.json` only after web and worker health pass. On failure,
   restore the previous web release and dedicated worker/state. Preserve every
   older release, all indexed history and newer account writes.

Complete history backfill is not required for activation; incomplete coverage
remains explicit in the API. The other cross-chain site's indexer, Docker ops,
allocator, governance timers and `/var/lib/xc-watchdog/run.lock` are untouched.
The source checkout and its dependencies are not changed by deployment. Account
schema changes must remain compatible with the preceding application; rollback
never restores a database snapshot over newer writes.

## Server locations

| Item                              | Location                                             |
| --------------------------------- | ---------------------------------------------------- |
| Source cache (fetch/archive only) | `/root/developer-portal-v2`                          |
| Private runtime settings          | `/var/lib/thesauros-portal-v2/runtime.env` (0600)    |
| Accounts                          | `/var/lib/thesauros-portal-v2/accounts.sqlite`       |
| Cross-chain event history         | `/var/lib/thesauros-portal-v2/history.sqlite`        |
| Immutable releases                | `/var/lib/thesauros-portal-v2/releases/`             |
| Active branch, SHA and directory  | `/var/lib/thesauros-portal-v2/current.json`          |
| Per-run status and logs           | `/var/lib/thesauros-portal-v2/deployments/`          |
| Database backups                  | `/var/lib/thesauros-portal-v2/backups/`              |
| Installed deployment service      | `/opt/thesauros-portal-deploy/`                      |
| Nginx configuration               | `/etc/nginx/sites-available/app-v2-dev.thesauros.io` |

Node is pinned to `/opt/node-v24.21.0-linux-x64/bin/node`. The deployment service
listens only on `127.0.0.1:18882`. PM2 web process `developer-portal-v2` listens on
`127.0.0.1:18880`; `developer-portal-migration-indexer` uses the same release and
history database. Existing systemd, PM2 startup and TLS renewal remain in place.

## Updating the installed automation

Repository pushes do not update the trusted deployment service itself. After
review and tests, and after confirming no deployment is running, back up the
installed automation and install **all five** runtime modules together:

```bash
install -m 0644 deploy/automation/{server,oidc,release,release-migration,health}.mjs /opt/thesauros-portal-deploy/
install -m 0644 deploy/automation/{package.json,package-lock.json} /opt/thesauros-portal-deploy/
cd /opt/thesauros-portal-deploy
/opt/node-v24.21.0-linux-x64/bin/node /opt/node-v24.21.0-linux-x64/lib/node_modules/npm/bin/npm-cli.js ci --omit=dev --ignore-scripts
systemctl restart thesauros-portal-deploy
curl --fail http://127.0.0.1:18882/health
```

The root-only service needs existing repository read access, the pinned Node/PM2,
production runtime/SQLite paths and permissions to manage only the portal's
managed processes. No new service environment variables, OIDC client secret,
nginx endpoint, public DNS or GitHub secret is required. Its environment contains
only PATH, NODE_ENV and NEXT_TELEMETRY_DISABLED; private application settings are
read by the release runner from the existing runtime file.

Before committing, run deployment tests with Node 24:

```bash
node --test deploy/automation/*.test.mjs test/deploy-migration.mjs
```

After a successful Git workflow compare `git ls-remote --heads origin
refs/heads/migration`, public `/api/version`, and `current.json`; branch and full
SHA must match. Confirm both PM2 processes use the recorded release and verify
`/app/individual` and its current assets through the real domain. The public
endpoint exposes only `{branch, sha}` with `Cache-Control: no-store`.

Manual deployment remains available from a reviewed checkout:

```bash
/opt/node-v24.21.0-linux-x64/bin/node deploy/automation/release-migration.mjs FULL_COMMIT_SHA
```

Do not wrap this command in another `flock` for the same lock. See
[MIGRATION-DEPLOYMENT.md](../docs/MIGRATION-DEPLOYMENT.md) for history coverage,
contract identity and backup details.
