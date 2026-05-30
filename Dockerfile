# Purpose: Production multi-stage image for WatchLog.
# Input/Output: Builds web assets, API JavaScript, Prisma client, and a runtime image.
# Invariants: Secrets are provided at runtime through env vars, never baked into the image.
# Debugging: Use `docker build --progress=plain .` for detailed build logs.

FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install

FROM deps AS build
ARG APP_COMMIT=unknown
ENV APP_COMMIT=$APP_COMMIT
COPY . .
RUN npm run prisma:generate
RUN npm run build -w @watchlog/shared
RUN npm run build -w @watchlog/web
RUN npm run build -w @watchlog/api
RUN mkdir -p apps/api/web && cp -R apps/web/dist/* apps/api/web/

FROM base AS runtime
ENV NODE_ENV=production
ARG APP_COMMIT=unknown
ENV APP_COMMIT=$APP_COMMIT
WORKDIR /app
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/apps/api/prisma /app/apps/api/prisma
COPY --from=build /app/apps/api/scripts /app/apps/api/scripts
COPY --from=build /app/apps/api/web /app/apps/api/web
COPY --from=build /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build /app/packages/shared/dist /app/packages/shared/dist
EXPOSE 8111
WORKDIR /app/apps/api
CMD ["node", "scripts/docker-entrypoint.mjs"]
