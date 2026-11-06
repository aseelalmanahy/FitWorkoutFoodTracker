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
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM node:24.21.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && rm -rf /root/.npm
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/.next ./.next
# next.config.ts is read at startup, with the one module it imports.
COPY next.config.ts ./
COPY src/lib/security-headers.ts ./src/lib/security-headers.ts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# The startup preflight refuses to serve on any unsafe configuration, and the exit restarts the container, visibly.
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
