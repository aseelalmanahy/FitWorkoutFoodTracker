# Production image. NOT yet built or run anywhere: no Docker daemon was available when this was written (tracker R-07).
# The Node version must match .nvmrc and package.json. Pin the base image by digest when the first image is approved.
FROM node:24.21.0-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY . .
# No database is needed to build: every page renders per request.
RUN npm run build

# The separate, explicitly run migration step. It holds the DDL credential, and the app never does.
FROM deps AS migrate
ENV NODE_ENV=production
# Applies nothing unless every migration in the image is in prisma/approved-migrations.json.
COPY scripts/migrate-approved.cjs ./scripts/migrate-approved.cjs
COPY scripts/lib/approved-migrations.cjs ./scripts/lib/approved-migrations.cjs
COPY prisma/approved-migrations.json ./prisma/approved-migrations.json
# Staging only, run by hand: one synthetic account at a reserved test domain (see the script).
COPY scripts/create-staging-account.cjs ./scripts/create-staging-account.cjs
CMD ["node", "scripts/migrate-approved.cjs"]

FROM node:24.21.0-bookworm-slim AS runner
WORKDIR /app
# The heap is pinned, so it doesn't follow the container's size: an export grows it and V8 keeps what it grew to
# (measured in G1, S-13). 768 MB holds an export at its row limit; the rest of the container is for native memory
# (the meal model, image processing).
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=768
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && rm -rf /root/.npm
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/.next ./.next
# next.config.ts is read at startup, with the one module it imports.
COPY next.config.ts ./
COPY src/lib/security-headers.ts ./src/lib/security-headers.ts
# On-device meal suggestions (MEAL_RECOGNITION=local) need the pinned model in the image, as the filesystem is
# read-only and the app never downloads. Opt in with --build-arg WITH_MEAL_MODEL=1. Every file is checked against its
# recorded SHA-256, and the startup preflight refuses MEAL_RECOGNITION=local without them. UNTESTED: no Docker daemon.
ARG WITH_MEAL_MODEL=0
COPY scripts/meal-model-fetch.cjs ./scripts/meal-model-fetch.cjs
COPY src/lib/server/meals/local-model.json ./src/lib/server/meals/local-model.json
RUN if [ "$WITH_MEAL_MODEL" = "1" ]; then node scripts/meal-model-fetch.cjs; fi
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# The startup preflight refuses to serve on any unsafe configuration, and the exit restarts the container, visibly.
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
