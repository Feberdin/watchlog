# Purpose: Production multi-stage image for WatchLog.
# Input/Output: Builds web assets, API JavaScript, Prisma client, and a runtime image.
# Invariants: Secrets are provided at runtime through env vars, never baked into the image.
# Debugging: Use `docker build --progress=plain .` for detailed build logs.

FROM node:26-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
# Why this exists: `npm ci` installs exactly the reviewed lockfile and fails if
# package metadata drifts, keeping local macOS dependencies out of the image.
RUN npm ci

FROM deps AS build
ARG APP_COMMIT=unknown
ENV APP_COMMIT=$APP_COMMIT
COPY . .
RUN node apps/api/scripts/write-build-info.mjs
RUN npm run prisma:generate
RUN npm run build -w @watchlog/shared
RUN npm run build -w @watchlog/web
RUN npm run build -w @watchlog/api
RUN mkdir -p apps/api/web && cp -R apps/web/dist/* apps/api/web/

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=build /app/package.json /app/package.json
COPY --chown=node:node --from=build /app/node_modules /app/node_modules
COPY --chown=node:node --from=build /app/apps/api/package.json /app/apps/api/package.json
COPY --chown=node:node --from=build /app/apps/api/node_modules /app/apps/api/node_modules
COPY --chown=node:node --from=build /app/apps/api/dist /app/apps/api/dist
COPY --chown=node:node --from=build /app/apps/api/prisma /app/apps/api/prisma
COPY --chown=node:node --from=build /app/apps/api/scripts /app/apps/api/scripts
COPY --chown=node:node --from=build /app/apps/api/web /app/apps/api/web
COPY --chown=node:node --from=build /app/packages/shared/package.json /app/packages/shared/package.json
COPY --chown=node:node --from=build /app/packages/shared/dist /app/packages/shared/dist

# Why this exists: the long-running API must not have root privileges, while its
# persistent cache/config mounts still need deterministic writable mount points.
RUN mkdir -p /cache /config \
  && chown -R node:node /app /cache /config
EXPOSE 8111
WORKDIR /app/apps/api
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:8111/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "scripts/docker-entrypoint.mjs"]
