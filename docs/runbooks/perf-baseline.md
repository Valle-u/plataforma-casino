# Performance baseline — Sprint 51.12

> Resultados del stress test con dataset realista de "1-2 meses de
> tráfico de un casino chico". **Status**: APROBADO, todos los
> endpoints sub-200ms p95.

## Dataset usado

Ejecución 2026-05-22 sobre `tenant_demo_dev`:

| Tabla | Antes | Después | Multiplicador |
|---|---|---|---|
| users | 1,563 | 16,563 | 10.6x |
| wallets | 1,069 | 16,069 | 15x |
| wallet_transactions | 14,736 | 64,736 | 4.4x |
| deposits | 1,146 | 3,146 | 2.7x |
| leagues | 39 | 89 | 2.3x |
| league_standings | 1,950 | 1,950 (sim conflict) | — |
| notifications | 4,254 | 14,254 | 3.4x |
| audit_log | 10,812 | 110,812 | 10.3x |

Generador: `apps/api/scripts/stress-generator.mjs` (bulk INSERT via
postgres-js, ~8.6s total).

## Mediciones de endpoints (5 corridas warm c/u)

| Endpoint | p50 | p95 | avg | Status |
|---|---|---|---|---|
| `/tenant/info` | 4ms | 6ms | 4ms | ✅ |
| `/tenant/auth/me` | 5ms | 6ms | 5ms | ✅ |
| `/tenant/wallet/me` | 5ms | 5ms | 5ms | ✅ |
| `/tenant/wallet/me/stats?windowDays=30` | 10ms | 17ms | 11ms | ✅ |
| `/tenant/promotions` | 9ms | 12ms | 10ms | ✅ |
| `/tenant/notifications/stats` | 15ms | 17ms | 15ms | ✅ |
| `/tenant/users?search=stress` | 28ms | 31ms | 28ms | ✅ |
| `/tenant/users` (sin filtros) | 17ms | 40ms | 20ms | ✅ |
| `/tenant/notifications` | 31ms | 47ms | 34ms | ✅ |
| `/tenant/users/stats` | 18ms | 74ms | 29ms | ✅ |
| `/tenant/leagues?status=active` | 67ms | 77ms | 68ms | ✅ |
| `/tenant/wallet-stats/summary?windowDays=30` | 58ms | 64ms | 59ms | ✅ |
| `/tenant/withdrawals` | 14ms | 21ms | 16ms | ✅ |
| `/tenant/deposits` | 49ms | 100ms | 60ms | ✅ |
| `/tenant/wallet-stats/movements?limit=50` | 154ms | 158ms | 152ms | ✅ |
| `/tenant/audit-log?limit=50` | 73ms | 173ms | 91ms | ✅ |
| `/tenant/audit-log?actionCodePrefix=deposits.` | 69ms | **189ms** | 93ms | ✅ |

**Conclusión**: 0/17 endpoints con p95 > 500ms. Sistema escala bien a
~5x el dataset productivo esperado.

## EXPLAIN ANALYZE de las queries más lentas

### Audit log con prefix filter (p95 189ms)

**Antes del fix**:
```
->  Parallel Seq Scan on audit_log
    (cost=0.00..4514.15 rows=8283 width=312)
    (actual time=0.008..9.459 rows=6662 loops=3)
Execution Time: 44ms
```

**Después del fix** (índice `audit_log_action_prefix_idx` con
`text_pattern_ops`):
```
->  Bitmap Index Scan on audit_log_action_prefix_idx
    (cost=0.00..635.22 rows=19880 width=0)
    (actual time=1.746..1.746 rows=19986 loops=1)
Execution Time: 25ms
```

**Mejora**: 44ms → 25ms (43% más rápido). Proyección a 1M+ entries:
- Sin índice: ~450ms (escala lineal).
- Con índice: <100ms (escala log).

**Migration creada**: `0029_audit_log_prefix_idx.sql`.

### Wallet_transactions JOIN (p95 158ms)

```
->  Hash Left Join (... wallets, users)
    (actual time=11.492..45.601 rows=32368 loops=2)
->  Sort (Sort Key: wt.created_at DESC, top-N heapsort)
Execution Time: 79ms
```

Plan eficiente, sin necesidad de fix. El index
`wallet_tx_wallet_created` ya está siendo usado para el JOIN, y el sort
top-N es rápido.

## Verificación de trazabilidad

### Deposit aprobado real → cadena audit + wallet_tx

```sql
-- Deposit del player real
id: 019e4d69-47f4-7616-a532-1bb511a46326
user_id: 019e4d69-3a17-752d-ae92-5847e304138e
amount_chips: 200.00
status: approved
wallet_tx_id: 019e4d69-4856-71ab-b438-0556bee602ca

-- Audit log para target_id = deposit.id
action_code           | actor_username
deposits.create       | e2e_sp17-ind-player_993jm1   ← player creó
deposits.approve      | e2e_sp17-ind-cajero_ycr3ic   ← cajero aprobó

-- Wallet_tx asociada
type: deposit
amount: 200.00
balance_after: 200.00
```

✅ Trazabilidad completa: create → approve → wallet_tx, tiempos
coherentes (~150ms entre create y approve).

### League closed → results.prize ↔ wallet_tx.amount

```sql
-- Top 3 ganadores de la league
position | score    | prize                              | wtx_type     | wtx_amount
1        | 1955.00  | {"kind":"chips","amount":50000}    | promo_reward | 50000.00
2        | 1869.00  | {"kind":"chips","amount":30000}    | promo_reward | 30000.00
3        | 1864.00  | {"kind":"chips","amount":15000}    | promo_reward | 15000.00
```

✅ Premio settleado == wallet_tx generada. Match perfecto.

### Bonus auto-grant tras deposit approve

```sql
-- user_bonus otorgado
id: 019e4d69-4894-75a5-bfa2-8f4cec97d565
def_code: sp17-branch-welcome
granted_amount: 60.00
granted_at: 2026-05-21 23:00:06

-- Audit del user_bonus
action_code: bonus.auto_grant
actor_username: e2e_sp17-ind-cajero_ycr3ic
metadata: {
  "depositId": "019e4d69-47f4-7616-a532-1bb511a46326",
  "triggeredBy": "deposits.approve"
}
```

✅ El audit lo apunta al deposit que lo triggeó. Cadena completa
deposit → approve → auto-grant.

## Findings + acciones

| # | Severidad | Hallazgo | Acción |
|---|---|---|---|
| 1 | MEDIUM | `audit_log` LIKE prefix usaba Seq Scan | ✅ Fixed: índice text_pattern_ops (migration 0029) |
| 2 | LOW | `LeaguesRecomputeCron` no logguea "Recomputed N" cuando N>0 si el cron muere mid-batch | 🟡 Investigar — no bloqueante (los standings se computan al close) |
| 3 | INFO | `wallet-stats/movements` con 65k rows toma 158ms p95 | OK — escala bien con índices actuales |

## Conclusiones

1. **El backend escala** al dataset de ~16k users / 65k tx / 110k
   audit sin degradación notable. Todos los endpoints p95 < 200ms.

2. **Trazabilidad es robusta** — los flows críticos (deposit approve,
   league settle, bonus auto-grant) dejan trail completo y correlable
   entre `audit_log`, `wallet_transactions`, `user_bonuses` y
   `league_results`.

3. **El único índice faltante** (audit_log prefix) se identificó y
   fixeó en este sprint. Mejora 43% en query del path más usado del
   admin.

4. **Crons**: el de leagues recompute itera 4 tenants en <1s con 89
   leagues; el de notifications dispatcher procesa el batch sin
   contención. No emergieron bottlenecks de scheduling.

## Próximos stress tests sugeridos

Cuando lleguemos al volumen de un cliente real (10k+ users activos
diarios), repetir este test con:

- 100k users / 1M wallet_tx / 1M audit_log → ver si los p95 se mantienen.
- Concurrencia simulada: 50-100 requests simultáneos al login + balance
  + deposits via k6.
- Profilar memory + CPU del proceso Node: ¿memory leak en pool de
  Postgres? ¿CPU saturation en queries pesadas?
- Postgres `pg_stat_statements` para detectar slow queries no
  identificadas en este pass.
