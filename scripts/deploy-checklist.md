# Checklist de deploy

## Pre-requisitos

Antes del primer deploy, configurar estos **secrets y variables en GitHub**
(`Settings → Secrets and variables → Actions`):

### Secrets (sensible — nunca se ven en logs)

| Secreto | Valor | Obtenido de |
|---|---|---|
| `DATABASE_URL_CONTROL` | `postgres://postgres:...@sakura.proxy.rlwy.net:34436/platform_control` | Railway dashboard → Variables |
| `RAILWAY_API_TOKEN` | `abc123...` | Railway → Account Settings → Tokens → Create |
| `VERCEL_DEPLOY_HOOK` | `https://api.vercel.com/v1/integrations/deploy/...` | Vercel → Project → Settings → Git → Deploy Hooks |

### Variables (no sensible — visibles en logs)

| Variable | Valor | Obtenido de |
|---|---|---|
| `RAILWAY_SERVICE_ID` | `abc123...` | Railway → Project → Service → Settings → General |
| `RAILWAY_ENVIRONMENT_ID` | `abc123...` | Railway → Project → Settings → General |

## Cómo obtener cada uno

### Railway API Token
1. Ir a https://railway.app → click en tu avatar (arriba a la derecha) → **Account Settings**
2. Pestaña **Tokens** → **Create New Token**
3. Nombre: `github-actions-deploy`
4. Copiar el token (se muestra una sola vez)

### Railway Service ID + Environment ID
1. Ir a Railway → Project `plataforma-casino`
2. Hacer click en el servicio `plataforma-casino`
3. Ir a **Settings** → **General**
4. Ahí están **Service ID** y **Environment ID**
5. Alternativa: mirá la URL del navegador:
   `https://railway.app/project/{projectId}/service/{serviceId}?environmentId={environmentId}`

### Vercel Deploy Hook
1. Ir a Vercel → Project `plataforma-casino-web` → **Settings** → **Git**
2. Sección **Deploy Hooks** → **Create Hook**
3. Nombre: `CI/CD Pipeline`, Branch: `main`
4. Copiar la URL generada

### DATABASE_URL_CONTROL
Ya está en Railway → Project → Variables. Es la URL de conexión a Postgres.

## Cómo agregarlos en GitHub

1. Ir a https://github.com/Valle-u/plataforma-casino/settings/secrets/actions
2. **Secrets**: click "New repository secret" por cada uno
3. **Variables**: click "New repository variable" por cada una

## Flujo del deploy

```
git push → deploy.yml (GitHub Actions)
  ├── ci (lint + build + type-check)
  ├── migrate (db:migrate:control + db:migrate:tenants)
  ├── deploy (Railway GraphQL API + Vercel hook)
  └── healthcheck (API /health + Web frontpage)
```

Cada paso depende del anterior. Si `ci` falla, no migra ni deploya.

## Railway auto-deploy

Railway actualmente tiene auto-deploy desde GitHub activado.
Cuando configures el pipeline completo, **desactivá el auto-deploy** en
Railway → Project → Settings → GitHub → "Auto Deploy" → OFF.

Esto evita que Railway deploye antes de que CI termine.

## Rollback manual

Si el healthcheck falla:

1. **Railway**: Project → Deployments → deploy conocido bueno → "Redeploy"
2. **Vercel**: Project → Deployments → deploy conocido bueno → ⋮ → "Promote to Production"
3. Fixeá el bug en una branch → PR → merge → CI vuelve a deployar
