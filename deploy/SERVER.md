# app-v2-dev.thesauros.io deployment

Every push to `v2` runs the `Account app` workflow. After its tests and build
succeed, `Deploy app-v2-dev` deploys that commit to
<https://app-v2-dev.thesauros.io/app/>. Other branches and pull requests do not
deploy. The workflow can also be run manually with `v2` selected.

## Authentication

The deployment job uses a short-lived GitHub OIDC token. No SSH private key,
database secret or deployment password is stored in GitHub Actions.

The server validates GitHub's signature, expiration and audience, then checks
the repository and owner IDs, `refs/heads/v2`, the exact `web.yml` workflow,
commit, event and GitHub-hosted runner. Requests from forks, pull requests,
other branches and other workflows are rejected. Both GitHub subject formats
are supported; immutable repository and owner IDs are always checked.

The endpoint is `POST /__deploy/v2`; authenticated `GET` requests report that
workflow run's status. A repeated request cannot redeploy the same run. OIDC
tokens and private application settings are not written to deployment logs.

## Release process

1. Fetch `v2` and confirm that the requested commit is still its latest commit.
2. Extract that commit into a new directory with its own dependencies.
3. Install dependencies, initialize an isolated build database and build Next.js.
4. Check again for a newer push; superseded builds skip activation.
5. Create a consistent SQLite backup, then run the account schema initializer.
6. Start a candidate on `127.0.0.1:18881` and check the sign-in page, JavaScript,
   session endpoint and unauthenticated workspace protection.
7. Switch only the portal's PM2 process, verify it again and save the process
   list. A failed activation restores and checks the previous application.

The running checkout and its dependencies are not modified during the build.
Deployments are serialized by GitHub concurrency and a server-side file lock.
The five newest release directories and the previous active release are kept.
The initial checkout is never pruned. Logs and database backups are retained.

Database migrations must remain compatible with the previous application.
Rollback restores the application, not the database: automatically restoring
a snapshot would discard account writes made after that snapshot. SQLite
backups are available for an operator-controlled database recovery.

## Server locations

| Item                          | Location                                             |
| ----------------------------- | ---------------------------------------------------- |
| Git checkout                  | `/root/developer-portal-v2`                          |
| Runtime settings              | `/var/lib/thesauros-portal-v2/runtime.env` (0600)    |
| Accounts                      | `/var/lib/thesauros-portal-v2/accounts.sqlite`       |
| Releases                      | `/var/lib/thesauros-portal-v2/releases/`             |
| Active commit and directory   | `/var/lib/thesauros-portal-v2/current.json`          |
| PM2 application configuration | `/var/lib/thesauros-portal-v2/pm2-current.json`      |
| Database backups              | `/var/lib/thesauros-portal-v2/backups/`              |
| Per-run status and logs       | `/var/lib/thesauros-portal-v2/deployments/`          |
| Installed deployment service  | `/opt/thesauros-portal-deploy/`                      |
| Public-source cache           | `/root/private-state/live-cache`                     |
| Nginx configuration           | `/etc/nginx/sites-available/app-v2-dev.thesauros.io` |

The app uses the built-in developer sandbox and persistent local SQLite.
Registration is available in the UI. External Partner API credentials are not
configured. Private settings and account data are outside Git and all releases.
The original checkout's `.env.local` belongs to the initial manual deployment;
automated releases use `runtime.env` instead.

Node.js is pinned to `/opt/node-v24.21.0-linux-x64/bin/node`. PM2 process
`developer-portal-v2` listens on `127.0.0.1:18880`. The separate deployment
service listens on `127.0.0.1:18882`. Both are configured to start on boot.
TLS renewal is provided by `certbot.timer`.

```bash
pm2 status developer-portal-v2
pm2 logs developer-portal-v2 --lines 50
pm2 restart /var/lib/thesauros-portal-v2/pm2-current.json --only developer-portal-v2 --update-env
pm2 save
systemctl status thesauros-portal-deploy
journalctl -u thesauros-portal-deploy --since today
```

The service's reviewed implementation is versioned in `deploy/automation/`.
To update the deployment service itself, install its `.mjs` files and package
files into `/opt/thesauros-portal-deploy`, run `npm ci --omit=dev --ignore-scripts`
there with Node.js 24, and restart the service after any active deployment has
finished. Application pushes do not replace the running deployment service.

Nginx maps `/app/*` to `/developers/customer/*`, forwards `/developers/*`
unchanged, and maps `/monitoring/*` to `/developers/monitoring/*`. `/` redirects
to `/app/`. Documentation and contact links redirect to their public sites.
The dev host sends `X-Robots-Tag: noindex, nofollow`.
