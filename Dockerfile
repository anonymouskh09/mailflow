# One image for both the web/API and the worker (different commands in docker-compose.prod.yml).
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY packages/db/prisma packages/db/prisma
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w @mailflow/web

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
RUN useradd --system --uid 10001 mailflow && chown -R mailflow /app
USER mailflow
EXPOSE 3000
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]
