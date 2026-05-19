# Observability Runbook

> **Status MVP**: el sistema NO tiene Grafana/Prometheus integrados. Esta
> guía documenta QUÉ métricas mirar + cómo agregar observability cuando
> sea hora. Mientras tanto, monitoring básico = logs estructurados +
> Postgres queries ad-hoc.

## Filosofía

- **Audit log es la fuente de verdad** para mutations sensibles. Antes
  de instrumentar métricas, chequear si la query sobre `audit_log` ya
  responde la pregunta.
- **Logs estructurados** (NestJS Logger output) cubren operaciones del
  sistema. Cada Logger.error/warn debe ser actionable.
- **Métricas custom** solo cuando emerge una pregunta repetida que
  no puede responderse con audit + logs.

---

## ¿Qué mirar día-a-día?

### Salud del sistema (cada día / cada deploy)

| Pregunta | Cómo responderla hoy |
|---|---|
| ¿Está vivo? | `curl https://demo.casino.com/health` |
| ¿Cuántos requests por minuto? | Postgres `audit_log` count agrupado por minuto |
| ¿Errores 5xx? | API logs (grep `ERROR`) |
| ¿Sesiones activas? | `SELECT COUNT(*) FROM user_sessions WHERE revoked_at IS NULL AND expires_at > NOW();` por tenant |

### Métricas críticas de negocio

| Métrica | Query (Postgres) |
|---|---|
| Total chips minted en últimas 24h | `SELECT SUM(amount) FROM wallet_transactions WHERE type='mint' AND created_at > NOW() - INTERVAL '1 day';` |
| Depósitos pendientes > 1h | `SELECT COUNT(*) FROM deposits WHERE status='pending' AND created_at < NOW() - INTERVAL '1 hour';` |
| Retiros approved sin pagar > 4h | `SELECT COUNT(*) FROM withdrawals WHERE status='approved' AND updated_at < NOW() - INTERVAL '4 hours';` |
| GGR de hoy (bets - wins) | `SELECT SUM(bet_amount) - SUM(win_amount) FROM game_rounds WHERE status='settled' AND placed_at::date = CURRENT_DATE;` |
| Commissions pagadas hoy | `SELECT SUM(payout_amount) FROM commission_payouts WHERE status='paid' AND paid_at::date = CURRENT_DATE;` |

### Antifraude

| Pregunta | Query |
|---|---|
| Clusters suspected pending | `SELECT COUNT(*) FROM fraud_account_links WHERE status='suspected';` |
| Users con auto-exclusion activa | `SELECT COUNT(*) FROM self_exclusions WHERE status='active' AND (ends_at IS NULL OR ends_at > NOW());` |

---

## Alertas sugeridas (cuando emerja Grafana / Slack webhook)

| Trigger | Por qué | Severidad |
|---|---|---|
| API 5xx rate > 1% en 5min | Algo se rompió en hot path | Alta |
| Depósito pending > 4h sin acción del cajero | SLA con el jugador | Media |
| Wallet de admin con saldo < 1000 chips | No puede aprobar deposits ni pagar commissions | Media |
| Login failures > 100 en 5min | Brute force / botnet | Alta |
| `wallet_transactions` con `balance_after < 0` | Bug crítico de wallet (no debería pasar) | Crítica |
| Cron job no corrió en su ventana esperada | Bonus expire, fraud scan, etc. | Media |

### Implementación sugerida cuando se integre Grafana

1. **Postgres exporter** (`prometheus-community/postgres_exporter`) scrapeando
   queries custom (las de arriba) cada 1min.
2. **NestJS metrics** con `@willsoto/nestjs-prometheus` para latencia +
   error rate por endpoint.
3. **Slack webhook** receptor → un canal `#casino-alerts` con cada alert.
4. **Dashboard Grafana** con paneles para las métricas críticas (GGR del día,
   pending counts, error rates, etc.).

---

## Logging guidelines

- **Cada `Logger.error()` debe tener un user-facing fix** documentado en
  el mismo archivo (comentario `// FIX: cómo investigar`).
- **Cada `Logger.warn()` indica un estado raro pero no fatal**. Si emerge
  con frecuencia, debería ser `error` o no loguearse.
- **NO PII en logs** (passwords, emails, full names en plain). El audit_log
  es para eso.
- **Format estándar**: `[tenant=<slug>] <action>: <details>`.

Ejemplo (existente en TenantAuthService):
```typescript
this.logger.warn(`[tenant=${tenantId}] Login fallido: username ${username} no existe`);
```

---

## Métricas que el código YA expone

| Endpoint | Información |
|---|---|
| `GET /health` | Liveness — siempre 200 si el proceso corre. |
| `GET /readyz` | Readiness — incluye check de Postgres. |
| `GET /tenant/info` | Por tenant: ping a la DB del tenant resuelto. |

---

## Performance baseline (Sprint 38)

Los scripts k6 en `perf/` son la fuente de verdad de "qué espera el sistema
soportar". Correr `k6 run perf/baseline.js` semanalmente (en staging si
disponible) y comparar p95 vs target:

| Endpoint | Target p95 | Acción si excede |
|---|---|---|
| Login | 300ms | Profile query del findByUsername; agregar index si falta |
| /me | 200ms | Cache en Redis (no implementado MVP) |
| /wallet/me | 200ms | Index sobre `wallets(user_id)` ya existe; chequear locks |
| /games/active | 200ms | Index `games_active_category_sort` ya existe |

Si baseline pasa OK pero spike (`spike.js`) muestra degradación severa,
considerar:
- Pool de conexiones Postgres muy chico (`pool_max` en config).
- N+1 queries en algún endpoint (verificar con `EXPLAIN ANALYZE`).
- Falta de cache en `/tenant/info` (que el frontend pollea).
