FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@11 --activate
WORKDIR /app

# Root configs
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Workspace packages (needed by API)
COPY packages/typescript-config ./packages/typescript-config
COPY packages/eslint-config ./packages/eslint-config
COPY packages/db ./packages/db

# API app
COPY apps/api ./apps/api

# Install deps and build
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @casino/db build
RUN pnpm --filter @casino/api build

EXPOSE 3000

WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
