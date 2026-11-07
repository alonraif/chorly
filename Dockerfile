# One image for api, web and worker; docker-compose.yml picks the command per service.
FROM node:24-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1 \
  CHECKPOINT_DISABLE=1 \
  PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app

# Build with the full toolchain, then drop it: only production dependencies reach the running image.
FROM base AS build
RUN npm install -g pnpm@9.15.4
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @chorly/shared build \
  && pnpm --filter chorly-api prisma:generate \
  && pnpm --filter chorly-api build \
  && NODE_ENV=production pnpm --filter chorly-web build \
  && rm -rf apps/web/.next/cache
RUN CI=true pnpm install --frozen-lockfile --prod --offline \
  && pnpm --filter chorly-api prisma:generate

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.base.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/web/package.json /app/apps/web/next.config.mjs apps/web/
COPY --from=build /app/apps/web/node_modules apps/web/node_modules
COPY --from=build /app/apps/web/.next apps/web/.next
COPY --from=build /app/apps/web/public apps/web/public
COPY --from=build /app/apps/worker/package.json /app/apps/worker/tsconfig.json apps/worker/
COPY --from=build /app/apps/worker/node_modules apps/worker/node_modules
COPY --from=build /app/apps/worker/src apps/worker/src
# The code stays root-owned and read-only to the app; only the proofs volume is its to write.
RUN mkdir -p /data/proofs /data/apk && chown node:node /data/proofs
USER node
