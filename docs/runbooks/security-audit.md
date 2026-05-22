# Security Audit Runbook — OWASP Top 10 (2021)

> **Audiencia**: dueño + auditores + futuros agentes IA. **Status**:
> primera pasada formal del Sprint 51.10 (2026-05-22).
> Re-correr antes de cada release con cliente externo.

## Resumen ejecutivo

Primera ejecución completa del checklist OWASP top 10 sobre el MVP el
2026-05-22. **Resultado: APROBADO con 2 findings MEDIUM** documentados
como riesgo aceptado / mitigación parcial.

| OWASP | Categoría | Status | Findings |
|---|---|---|---|
| A01 | Broken Access Control | ✅ PASS | 0 |
| A02 | Cryptographic Failures | ✅ PASS | 0 |
| A03 | Injection | ✅ PASS | 0 |
| A04 | Insecure Design | 🟡 PASS w/finding | 1 MEDIUM |
| A05 | Security Misconfiguration | ✅ PASS (post-fix) | 1 fixed |
| A06 | Vulnerable Components | ✅ PASS (post-fix) | 28 fixed, 1 mitigado |
| A07 | Auth Failures | ✅ PASS | 0 |
| A08 | Software Integrity | ✅ PASS | 0 |
| A09 | Logging & Monitoring | ✅ PASS | 0 (Sprint 51.10) |
| A10 | SSRF | ✅ PASS | 0 |

**Findings activos**:
- M-001 (A04): credential stuffing por IP no rate-limited.

**Findings cerrados durante el audit**:
- H-001 (A05): faltaban security headers → fixed con helmet.
- H-002 (A05): `/tenant/info` exponía `db_name` interno → fixed.
- C-001 + C-002 (A06): 2 CVE críticas en Next.js (RCE + Auth Bypass) →
  fixed bumping a 15.5.16+.
- H-003..H-010 (A06): 8 high en Next.js + Drizzle → fixed.
- 18 moderate transitivas (postcss, qs, brace-expansion) → fixed via
  `pnpm.overrides`.

---

## A01 — Broken Access Control

**Defensa**: PermissionsGuard atómico (`@RequirePermissions`),
TenantJwtGuard, PanelOnly decorator, scope guards (`@ScopeTarget`),
multi-tenant isolation por DB-per-tenant.

**Probes ejecutados** (con curl contra dev):

| # | Probe | Esperado | Resultado |
|---|---|---|---|
| 1 | Player → `GET /tenant/users/stats` | 403 (NOT_PANEL_USER) | ✅ 403 |
| 2 | Player → `GET /tenant/wallet/user/<other-id>` (IDOR) | 403 (wallet.view_any) | ✅ 403 |
| 3 | Player → `GET /tenant/users` | 403 | ✅ 403 |
| 4 | Player → `GET /tenant/deposits` | 403 (deposits.view) | ✅ 403 |
| 5 | Player → `POST /tenant/wallet/mint` | 403 (wallet.mint) | ✅ 403 |
| 6 | Sin Authorization header → endpoint admin | 401 | ✅ 401 |
| 7 | JWT del demo tenant → `X-Tenant-Host: sandbox.localhost` | 401 (token bound a tenant) | ✅ 401 |
| 8 | JWT malformed | 401 | ✅ 401 |
| 9 | JWT firma inválida | 401 | ✅ 401 |

**Resultado**: 9/9 PASS. Cross-tenant isolation funciona. IDOR cubierto
por checks de permisos explícitos.

---

## A02 — Cryptographic Failures

**Defensa**: Argon2id (`@node-rs/argon2`) para passwords, JWT con
HS256 + secrets de 64+ chars random, sin cleartext storage de
secretos, TLS upstream (responsabilidad del reverse proxy).

**Checks**:

| Item | Status |
|---|---|
| Password hashing algoritmo | ✅ Argon2id (`packages/db/src/utils/password.ts`) |
| JWT_ACCESS_SECRET length | ✅ 66 chars |
| JWT_REFRESH_SECRET length | ✅ 64 chars |
| Hardcoded secrets en código | ✅ Cero matches `grep -rE "(secret|api_key)\s*=\s*['\"][a-zA-Z0-9_-]{16,}"` |
| `/tenant/auth/me` leakea passwordHash? | ✅ NO |
| `/tenant/auth/me` leakea twoFaSecret? | ✅ NO |
| recovery codes nunca devueltos en plain (post-grant) | ✅ Solo en el grant inicial |

**Resultado**: PASS.

---

## A03 — Injection

**Defensa**: Drizzle ORM (parametrized queries por default), `class-
validator` en todos los DTOs, `ParseUUIDPipe` en path params, escape
explícito de `%` y `_` en LIKE/ILIKE.

**Probes**:

| # | Probe | Resultado |
|---|---|---|
| 1 | `?search=' OR 1=1 --` | total:0 (escapado, no match literal) |
| 2 | `?search=' UNION SELECT NULL,NULL --` | total:0 |
| 3 | `?search=%` | total:0 (no devuelve todo — % escapado) |
| 4 | Path UUID inválido | 400 (ParseUUIDPipe) |

**Resultado**: PASS. Drizzle + class-validator + ParseUUIDPipe cubren
todas las superficies relevantes. No usamos `sql.raw` con interpolación
de user input en lugares user-facing.

---

## A04 — Insecure Design

**Defensa**: rate limiting (`RateLimitGuard`), idempotency keys
(`Idempotency-Key` header), validación amount > 0 en mints/burns,
escape hatches con audit severity:high.

**Probes**:

| # | Probe | Resultado |
|---|---|---|
| 1 | 12 logins fallidos al mismo username | ✅ 11º → 429 (rate limit 10/15min) |
| 2 | 20 logins fallidos con usernames distintos (misma IP) | 🟡 **Todos 401** — sin throttle por IP-only |
| 3 | `POST /wallet/mint` con `amount: "-100"` | ✅ 400 (validación regex) |
| 4 | `POST /wallet/mint` con `amount: "0"` | ✅ 400 |
| 5 | Mismo `Idempotency-Key` 2×: ¿duplica tx? | ✅ Mismo `tx.id` devuelto, no duplica |

### Finding M-001: credential stuffing por IP no rate-limited

**Severidad**: MEDIUM.

**Detalle**: El rate limit de `/tenant/auth/login` usa scope
`ip+body.username` → 10 intentos/15min por username. Esto frena
brute-force de password de UN user específico (✓), pero NO frena
credential stuffing (atacante con leak de credenciales prueba 1000
usernames distintos desde misma IP, 1 intento c/u → todos pasan).

**Mitigación recomendada**: agregar un segundo bucket de rate limit
con scope `ip` (sin username) — ej. 100/15min. Frena spray sin
afectar usuarios legítimos en NAT compartido.

**Status**: documentado, fix sumado al backlog post-MVP (no bloquea
operación interna del dueño, sí bloquea si el sitio se expone
públicamente).

---

## A05 — Security Misconfiguration

**Probes + fixes aplicados durante el audit**:

### Fix H-001: faltaban security headers

**Antes**:
```
HTTP/1.1 200 OK
X-Powered-By: Express        ← tech stack leak
Content-Type: application/json
```

**Después** (post-helmet, commit en este sprint):
```
HTTP/1.1 200 OK
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-DNS-Prefetch-Control: off
X-Download-Options: noopen
X-Frame-Options: SAMEORIGIN
X-Permitted-Cross-Domain-Policies: none
X-XSS-Protection: 0
(NO X-Powered-By)
```

**Cambio**: `apps/api/src/main.ts` — `app.use(helmet({ contentSecurityPolicy: false }))`
+ `app.disable('x-powered-by')`.

### Fix H-002: `/tenant/info` exponía `db_name` interno

**Antes**: `"tenantDb": { "connectedTo": "tenant_demo_dev", ... }` —
cualquiera podía descubrir convención de naming.

**Después**: `"tenantDb": { "connected": true, "currentTime": "..." }` —
boolean sin info interna.

**Cambio**: `apps/api/src/tenant-info/tenant-info.controller.ts`.

### Checks que pasaron

- CORS: no responde a preflight `Origin: evil.attacker.com` con
  Access-Control-Allow-Origin. ✓
- Default password (`demo-pwd-2026`): solo en dev seed
  (`packages/db/src/scripts/seed-dev-tenant.ts`). Producción debe
  setear `DEMO_ADMIN_PASSWORD` env. ⚠️ **Action required al deploy
  prod**: setear envs reales o no usar el seed dev.
- `NODE_ENV=development` esperable en local.

---

## A06 — Vulnerable & Outdated Components

**Audit con `pnpm audit --prod`**:

### Antes del fix

```
29 vulnerabilities found
Severity: 4 low | 14 moderate | 9 high | 2 critical
```

Findings críticos:
- **C-001**: Next.js RCE in React flight protocol (apps/web/next).
- **C-002**: Authorization Bypass in Next.js Middleware.

Findings high (selección):
- Drizzle ORM SQL injection via improperly escaped (¡!)
- Next.js DoS variantes (×7).
- Next.js SSRF.

### Acciones aplicadas

```bash
pnpm --filter @casino/web add next@^15.5.16
pnpm --filter @casino/db add drizzle-orm@^0.45.2
pnpm --filter @casino/api add drizzle-orm@^0.45.2
pnpm --filter @casino/web add postcss@^8.5.10 -D

# Overrides para transitivas (root package.json)
"pnpm": {
  "overrides": {
    "postcss": ">=8.5.10",
    "qs": ">=6.15.2",
    "brace-expansion": ">=5.0.6"
  }
}
```

### Después

```
1 vulnerabilities found
Severity: 1 moderate
```

Resto único: postcss bundled DENTRO de Next.js (path
`apps__web>next>postcss`, no es dep separada nuestra). Solo
explotable build-time, no runtime. Esperando upstream bump de Next.

### Recomendación operativa

- Correr `pnpm audit --prod` semanalmente.
- Bumps mayores de Next.js cada 2-3 meses como mínimo.
- Configurar Dependabot / Renovate cuando se conecte a GitHub Actions.

---

## A07 — Identification & Authentication Failures

**Defensa**:
- Argon2id (A02).
- Rate limit en login (A04).
- 2FA TOTP + recovery codes (`tenant-auth/two-fa.service.ts`).
- Refresh token rotation con reuse detection — si alguien usa un
  refresh token ya rotado, se revocan TODAS las sessions del user
  (defensa contra refresh token theft).
- Session ID (`sid`) en JWT — prevents session fixation.
- Logout revoca sesión en `user_sessions`.

**Checks**: ver código en `tenant-auth.service.ts` líneas
240-275 (refresh + reuse detection) y 380-400 (sid en payload).

**Resultado**: PASS.

---

## A08 — Software & Data Integrity Failures

**Defensa**:
- Sin deserialización peligrosa: `grep -rE "Function\(|eval\(|
  unserialize|child_process" apps/api/src` → 0 matches.
- Body parsing solo via class-validator (no `JSON.parse` con
  reviver controlado por user).
- Migrations DB explícitas via Drizzle Kit (no auto-migrate al boot).

**Resultado**: PASS.

---

## A09 — Security Logging and Monitoring Failures

**Defensa** (cubierto Sprint 51.10):
- `apps/api/src/common/redact.ts` — utility central de redaction.
- `GlobalExceptionFilter` con `redactHttpRequest()` — body/headers/
  query/params redactados en stack traces.
- `AuditLogService.record()` aplica `redactSensitive` automáticamente
  a before/after/metadata (defense-in-depth).
- 7 `logger.warn` en auth services usan `hashForLog(username)` o
  `user.id` (no literal username/email).
- 17 unit tests en `redact.spec.ts`.

**Validación**: probe real con `username='fake-user-9999'` → log dice
`usr_2b30efe9` (no leak).

**Resultado**: PASS.

---

## A10 — Server-Side Request Forgery (SSRF)

**Defensa**:
- `receiptUrl` del user (del flujo deposit) es solo almacenado +
  devuelto al cliente. NUNCA se hace `fetch(receiptUrl)` en el
  backend. El comprobante se sirve via R2/storage con keys propios
  (no URLs arbitrarias).
- Twilio SMS provider: `fetch(this.baseUrl, ...)` donde `baseUrl` es
  config-controlled (env var), no user input.
- Storage health check: round-trip al propio bucket R2 (config-
  controlled).

**Checks**:
- `grep "fetch(" apps/api/src/deposits/...` con `receiptUrl` → 0
  matches (almacenado solo).

**Resultado**: PASS.

---

## Checklist post-audit

- [x] Todos los findings CRITICAL fixed.
- [x] Todos los findings HIGH fixed.
- [x] Findings MEDIUM documentados con mitigación + status.
- [x] Findings LOW aceptados o documentados.
- [x] Re-run `pnpm audit --prod` post-bump.
- [x] Re-run probes A01-A10 post-fix.

## Próximas pasadas (calendario sugerido)

- **Cada release con cliente externo**: re-correr audit completo.
- **Mensualmente**: `pnpm audit` + actualizar deps si emerge CVE.
- **Cuando se conecte el primer cliente externo**: contratar pentest
  profesional externo (no solo self-audit).
