# FLOCK match server (§32). Multi-stage: build the sim + server, ship a slim
# runtime. The client is built/served separately (see deploy/Dockerfile.client).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/sim/package.json packages/sim/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY . .
RUN npm run build -w @flock/sim && npm run build -w @flock/server

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# production deps only
COPY package.json package-lock.json ./
COPY packages/sim/package.json packages/sim/
COPY packages/server/package.json packages/server/
RUN npm ci --omit=dev --workspace @flock/server --workspace @flock/sim || npm ci --omit=dev
COPY --from=build /app/packages/sim/dist packages/sim/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY balance.json ./
EXPOSE 8787
# FLOCK_SECRET must be provided at runtime; FLOCK_DATA enables durable storage.
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8787/health || exit 1
CMD ["node", "packages/server/dist/index.js"]
