# ── Build stage ──
FROM node:22-slim AS build

ARG APP_VERSION=unknown
ENV VITE_APP_VERSION=$APP_VERSION

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

RUN npm ci

# Copy source
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY packages/client/ packages/client/

# Build shared → server → client
RUN npm -w @game/shared run build && \
    npm -w @game/server run build && \
    npm -w @game/client run build

# ── Runtime stage ──
FROM node:22-slim

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist

# Save data directory
RUN mkdir -p packages/server/data

EXPOSE 3001

CMD ["node", "packages/server/dist/index.js"]
