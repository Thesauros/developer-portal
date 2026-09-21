# Account access

Individual uses RainbowKit/wagmi (the same connection stack as app.thesauros.io), including injected wallets and WalletConnect. A Sign-In with Ethereum message creates an authenticated Better Auth session. No email, password, token approval or blockchain transaction is requested for sign-in.

The server checks the configured public origin, supported chain, exact statement and URI, issue/expiry timestamps, signature and one-time nonce. The nonce is bound to an HttpOnly browser cookie. EOA signatures are checked locally; ERC-1271 contract wallets are verified against the configured chain RPC. The session token stays in an HttpOnly cookie.

A wallet maps to one Individual account across the supported sign-in chains (Arbitrum, Base, Ethereum). Test balances persist by authenticated user ID. Switching to another wallet closes the previous session and asks the user to sign in again. Rejected connection/signature requests can be retried in the wallet dialog.

Institution, `/developers` and the legacy monitoring page show Coming soon, with contact and docs links. The Institution UI code is retained for a later release. No public email signup/login or password recovery route remains active. Existing email accounts, recovery records and test workspaces are retained in the database without being silently attached to a wallet.

## Storage and deployment

Configure `BETTER_AUTH_URL` to the exact external origin, including the scheme and port. Set a unique `BETTER_AUTH_SECRET`. Secure cookies are used with HTTPS. The preview proxy overwrites `X-Real-IP`; only place the app behind trusted proxies that overwrite this header, since it supplies the authentication rate-limit identity.

Local preview uses `THESAUROS_AUTH_DB` (better-sqlite3). When `TURSO_DATABASE_URL` is set, the app uses libSQL for both Better Auth (through the Kysely dialect) and transactional workspace persistence. Set `TURSO_AUTH_TOKEN` if required. Run `node --env-file=.env.local scripts/init-auth.mjs` before the first start and after this update to add the wallet identity table. This migration preserves existing records. Back up the database before deployment.

`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` can override the existing public project identifier used by the old app. Configure the deployment's allowed origins in the WalletConnect project when an allowlist is enabled. The origin must also match the signed message and `BETTER_AUTH_URL`.

The web app serves native `/app/*` and `/api/*` routes directly, as described in DEPLOYMENT.md. An IP/HTTP preview is useful for review; use the production HTTPS origin when testing real mobile wallet handoff.

## Test scope

`npm test` includes cryptographic login, nonce replay, cross-browser challenge use, wrong signer/domain/URI/statement, expiry, account isolation, cross-chain identity, logout, and disabled email/Institution access on both SQLite and local libSQL. Those tests use freshly generated disposable keys and databases; they do not send transactions or use customer wallets.

The Individual test account remains a simulation with explicitly supplied test funds. Wallet sign-in does not turn these deposits into real vault transactions. Live protocol/market reporting and read-only wallet balances retain their existing data sources.

### WalletConnect QR compatibility

`cuer@0.0.3`, used by RainbowKit, requests a borderless QR matrix and draws its own padding. Its broad `qr ~0` dependency also accepts 0.6+ releases that reject `border: 0`. The scoped override pins `qr` to 0.5.5 until cuer supports the new API; verify the WalletConnect QR modal when changing this override.
