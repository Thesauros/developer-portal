# Thesauros account app — Individual / Institution workspaces, the API
# sandbox and the Strategy Lab.
#
# Build context is this repository's root. The app is a Next.js server, not a
# static export: it needs a writable SQLite file for accounts and a cache
# directory for the public rate feeds, both of which live on one mounted volume.
#
# Routes are native at /app, /api and /monitoring. next.config.mjs ignores
# NEXT_PUBLIC_BASE_PATH, so no path prefix is baked into the image.

FROM node:22-bookworm-slim AS deps
WORKDIR /app/web
# better-sqlite3 ships prebuilt binaries for the common platforms and falls
# back to node-gyp when none matches, so the toolchain has to be present or
# the build fails on whatever architecture has no prebuild that week.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci


FROM deps AS build
# NEXT_PUBLIC_* values are inlined at build time, so the data source has to be
# known here rather than at `docker run`.
ARG NEXT_PUBLIC_DATA_SOURCE=sandbox
ENV NEXT_PUBLIC_DATA_SOURCE=$NEXT_PUBLIC_DATA_SOURCE \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
# The build imports lib/auth.mjs, which opens the accounts database on module
# load. A throwaway secret and path keep that out of the runtime volume — the
# real ones arrive as environment variables when the container starts.
#
# The database has to exist and already be in WAL mode before `next build`
# starts: the build runs several worker processes, they open the same file at
# once, and each one tries to switch the journal mode. The first wins and the
# rest get SQLITE_BUSY, which fails the build. Running init-auth first turns
# every worker's pragma into a no-op.
RUN BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime \
    THESAUROS_AUTH_DB=/tmp/build-accounts.sqlite \
    sh -c 'node scripts/init-auth.mjs && npm run build' \
  && rm -f /tmp/build-accounts.sqlite*


FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/web

COPY --from=build /app/web ./

# lib/live-data.mjs caches the public rate feeds in ../private-state relative
# to the working directory, and the accounts database sits beside it. One
# volume mounted at /app/private-state covers both.
RUN mkdir -p /app/private-state && chown -R node:node /app/private-state
VOLUME ["/app/private-state"]

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER node
EXPOSE 18880

HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:18880/api/v1/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "18880"]
