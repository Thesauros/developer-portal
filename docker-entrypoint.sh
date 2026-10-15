#!/bin/sh
# Bring the accounts database up to the current schema before serving.
#
# init-auth is idempotent (CREATE TABLE IF NOT EXISTS plus Better Auth's own
# migration runner), so running it on every start is what keeps a long-lived
# volume in step with the image rather than something to do once by hand and
# forget after the next upgrade.
set -e

if [ -z "$BETTER_AUTH_SECRET" ]; then
  echo "BETTER_AUTH_SECRET is not set. Refusing to start with a guessable session secret." >&2
  exit 1
fi

echo "web: preparing accounts database at ${THESAUROS_AUTH_DB:-../private-state/accounts.sqlite}"
node scripts/init-auth.mjs

exec "$@"
