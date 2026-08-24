# syntax=docker/dockerfile:1
# Dockerfile del frontend Next.js para desplegar en el VPS (Dokploy).
# Espeja el patrón del Dockerfile de la API (raíz), pero produce una imagen
# liviana usando la salida `output: 'standalone'` de Next (ver next.config.ts).

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@11 --activate
WORKDIR /app

# Los NEXT_PUBLIC_* se hornean en el bundle del CLIENTE durante `next build`.
# Por eso van como build args (NO como env de runtime del contenedor): setearlos
# solo al arrancar no actualiza el bundle ya compilado.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_TENANT_HOST
ARG NEXT_PUBLIC_API_ORIGIN
ARG NEXT_PUBLIC_WORKER_ORIGIN
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
ARG NEXT_PUBLIC_CRM_ENABLED
ARG NEXT_PUBLIC_TURNSTILE_SITEKEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_TENANT_HOST=$NEXT_PUBLIC_TENANT_HOST \
    NEXT_PUBLIC_API_ORIGIN=$NEXT_PUBLIC_API_ORIGIN \
    NEXT_PUBLIC_WORKER_ORIGIN=$NEXT_PUBLIC_WORKER_ORIGIN \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT \
    NEXT_PUBLIC_CRM_ENABLED=$NEXT_PUBLIC_CRM_ENABLED \
    NEXT_PUBLIC_TURNSTILE_SITEKEY=$NEXT_PUBLIC_TURNSTILE_SITEKEY \
    NEXT_TELEMETRY_DISABLED=1

# Configs raíz del monorepo.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Packages internos que el build del web necesita (tsconfig/eslint compartidos).
# El web NO depende de @casino/db (habla con la API por HTTP).
COPY packages/typescript-config ./packages/typescript-config
COPY packages/eslint-config ./packages/eslint-config

# App web.
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @casino/web build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Usuario no-root.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Salida standalone del monorepo: server mínimo + node_modules trazados en la
# raíz, más los estáticos y `public` en apps/web/.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

# El server standalone del monorepo queda en apps/web/server.js.
CMD ["node", "apps/web/server.js"]
