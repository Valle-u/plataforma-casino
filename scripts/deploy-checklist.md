# Checklist de deploy

## Pre-requisitos

Antes del primer deploy, configurar estos **secretos en GitHub** (`Settings → Secrets and variables → Actions`):

| Secreto | Valor | Obtenido de |
|---|---|---|
| `DATABASE_URL_CONTROL` | `postgres://postgres:...@sakura.proxy.rlwy.net:34436/platform_control` | Railway dashboard → Variables |
| `RAILWAY_DEPLOY_HOOK` | `https://railway.app/api/hooks/...` | Railway dashboard → Deploy Hooks |
| `VERCEL_DEPLOY_HOOK` | `https://api.vercel.com/v1/integrations/deploy/...` | Vercel dashboard → Deploy Hooks |
| `API_HEALTH_URL` | `https://plataforma-casino-production.up.railway.app` | Railway dashboard |
| `WEB_HEALTH_URL` | `https://plataforma-casino-web-ur4.vercel.app` | Vercel dashboard |
| `TURBO_TOKEN` | (opcional) | Vercel Turbo Remote Cache |

## Cómo obtener cada uno

### Railway Deploy Hook
1. Ir a Railway → Project → Settings
2. Sección "Deploy Hooks" → "Generate Deploy Hook"
3. Copiar la URL generada

### Vercel Deploy Hook
1. Ir a Vercel → Project → Settings → Git
2. Sección "Deploy Hooks" → "Create Hook"
3. Nombre: "CI/CD Pipeline", Branch: `main`
4. Copiar la URL generada

## Flujo del deploy

```
git push → deploy.yml (GitHub Actions)
  ├── ci (lint + build + type-check)
  ├── migrate (db:migrate:control + db:migrate:tenants)
  ├── deploy (Railway hook + Vercel hook)
  └── healthcheck (API /health + Web /
```

Cada paso depende del anterior. Si `ci` falla, no migra ni deploya.

## Rollback manual

Si el healthcheck falla pero Railway/Vercel ya deployaron:

1. Railway: Project → Deployments → buscar el último deploy conocido bueno → "Redeploy"
2. Vercel: Project → Deployments → buscar el último deploy conocido bueno → ⋮ → "Promote to Production"
