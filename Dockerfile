# syntax=docker/dockerfile:1

# ---- build: install everything, typecheck, bundle -------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.29.1
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- run: the server has zero runtime dependencies, so no node_modules at all ----------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3105
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3105
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "server/server.mjs"]
