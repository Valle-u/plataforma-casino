# 05 · Flujos de Fichas (Wallet)

> Estado: **decidido en flujos core**. Variantes específicas se aclaran al implementar.

Toda operación financiera interna pasa por el módulo `wallet`. Este doc define los flujos, máquinas de estado, reglas de integridad y casos borde.

---

## 1. Reglas innegociables

1. **Una sola fuente de verdad**: `wallets.balance`. Solo se modifica vía transacciones registradas en `wallet_transactions`.
2. **Todo cambio de balance va dentro de una transacción Postgres** que inserta tx + actualiza balance atómicamente.
3. **Append-only** en `wallet_transactions`. Para revertir, se inserta una nueva fila tipo `rollback` referenciando la original.
4. **Idempotencia obligatoria**: toda mutación recibe `idempotency_key` (header HTTP). Reintento con misma key → mismo resultado, no duplica.
5. **Auditoría doble**: `wallet_transactions` (registro financiero) + `audit_log` (registro de quién/qué/por qué).
6. **Locking optimista** sobre `wallets.version` para evitar race conditions en operaciones concurrentes.
7. **Validación de scope antes de validación de balance**: primero permisos + jerarquía, luego saldo.
8. **Logs sin PII innecesario**: nunca loggear el balance completo en logs informativos.

---

## 2. Tipos de operación (catálogo)

| Tipo (`wallet_transactions.type`) | Quién origina | Efecto en balance |
|---|---|---|
| `mint` | **Solo Admin Tenant** | + (crea fichas desde la nada) |
| `burn` | **Solo Admin Tenant** | − (destruye fichas) |
| `load` | Cajero/Distribuidor/Admin (manual) o sistema (depósito aprobado) | + |
| `unload` | Cajero/Distribuidor/Admin (manual) | − |
| `transfer_in` | Sistema (par de transferencia) | + |
| `transfer_out` | Sistema (par de transferencia) | − |
| `bet` | Game Provider | − |
| `win` | Game Provider | + |
| `rollback` | Game Provider o admin | revierte una tx previa |
| `adjustment` | Admin con permiso especial | + o − (con motivo obligatorio) |
| `bonus_grant` | Sistema de promos | + (a `locked_balance`) |
| `bonus_clear` | Sistema (wagering cumplido) | mueve de `locked_balance` a `balance` |
| `bonus_forfeit` | Sistema (cancelación) | − del usuario, retorna al funder |
| `deposit` | Flujo de depósito autoservicio | + |
| `withdrawal` | Flujo de retiro | − |
| `promo_reward` | Sistema (sorteo / misión / ruleta) | + |
| `league_reward` | Sistema (cierre de liga) | + |
| `jackpot_win` | Sistema (jackpot disparado) | + |
| `commission_payout` | Sistema (cierre de comisiones de Socio) | + |
| `fund_reserve` / `fund_release` | Sistema (reserva/liberación de premios) | hold/unhold (no afecta balance directamente) |

---

## 3. Flujo: carga manual de fichas

**Actores**: cajero/distribuidor/socio/admin → jugador (o nivel inferior).

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Cajero busca al usuario por username/teléfono/id              │
│ 2. Ingresa monto + nota opcional                                 │
│ 3. Frontend envía POST /wallet/load con Idempotency-Key          │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│ Backend valida en orden:                                         │
│   a. Auth + 2FA si aplica                                        │
│   b. Permiso atómico 'wallet.load'                               │
│   c. Scope: usuario destino dentro de su jerarquía               │
│   d. Idempotency: ¿ya existe una tx con esta key?                │
│   e. Saldo: el cajero tiene fichas suficientes en SU wallet      │
│   f. Límites: monto dentro de tenant_settings                    │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│ TRANSACCIÓN POSTGRES (todo o nada):                              │
│   1. SELECT wallets FROM cashier FOR UPDATE                      │
│   2. SELECT wallets FROM player FOR UPDATE                       │
│   3. INSERT wallet_transactions (type='transfer_out', cashier)   │
│   4. UPDATE wallets SET balance -= amount WHERE cashier          │
│   5. INSERT wallet_transactions (type='transfer_in', player)     │
│   6. UPDATE wallets SET balance += amount WHERE player           │
│   7. INSERT audit_log                                            │
│   8. INSERT idempotency_keys                                     │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│ Side effects (BullMQ, fuera de la TX, vía outbox):               │
│   - Notificar al jugador (in-app, livechat opcional)             │
│   - Actualizar métricas en tiempo real (panel)                   │
│   - Disparar webhooks configurados                               │
└──────────────────────────────────────────────────────────────────┘
```

**Errores comunes y respuesta**:
- Saldo insuficiente del cajero → `409 INSUFFICIENT_BALANCE`.
- Usuario destino fuera de jerarquía → `403 OUT_OF_SCOPE`.
- Idempotency key reutilizada con monto distinto → `409 IDEMPOTENCY_CONFLICT`.

---

## 4. Flujo: descarga manual (`unload`)

Inverso al anterior. El cajero quita fichas a un jugador (o un superior quita a un cajero) y las suma a su propia wallet. Mismas validaciones, mismo patrón transaccional.

> **Auditoría reforzada**: `unload` siempre requiere `reason` no nulo.

---

## 5. Flujo: transferencia entre niveles superiores

Distribuidor → Cajero, Socio → Distribuidor, Admin → Socio, etc.

Idéntico a `load`/`unload`, pero el `audit_log` registra `relation_type` para reportes de "asignación de saldo".

> El cajero **no** puede asignar saldo "hacia arriba" salvo que tenga `wallet.transfer` con scope inverso explícito (poco común).

---

## 6. Flujo: aprobación de depósito (autoservicio)

Cuando un jugador sube comprobante y un cajero/empleado aprueba:

```
1. Jugador envía solicitud (deposits.status = 'pending')
   - Sube comprobante a S3
   - Aparece en el panel del cajero asignado / pool de cajeros
2. Cajero revisa, opcionalmente marca 'under_review'
3. Cajero aprueba:
   - Permiso 'deposits.approve' + scope
   - TRANSACCIÓN:
     · UPDATE deposits SET status='approved', reviewed_by, reviewed_at
     · INSERT wallet_transaction (type='deposit') sobre wallet del jugador
     · UPDATE wallets += amount
     · UPDATE deposits.wallet_tx_id
     · INSERT audit_log
4. Side effects: notificación al jugador, push, mensaje en livechat
```

**Importante**: el saldo no sale de la wallet de un cajero (a diferencia de carga manual). Se crea ex nihilo en la wallet del jugador, contabilizado contra el ingreso real reportado por el comprobante. La conciliación posterior cruza con el banco.

---

## 7. Flujo: retiro

```
1. Jugador solicita retiro (amount, target_account)
2. Sistema:
   - Verifica balance disponible (no en hold)
   - Crea wallet_hold por el monto
   - INSERT withdrawals.status='pending'
3. Cajero/empleado con 'withdrawals.approve' revisa
4. Aprueba:
   - status='approved'
   - Notifica al área de pagos
5. Pagador externo (humano o automático cripto):
   - Realiza la transferencia real
   - Marca 'paid' con external_ref
   - TRANSACCIÓN:
     · INSERT wallet_transaction (type='withdrawal')
     · UPDATE wallets -= amount
     · DELETE/RELEASE wallet_hold
6. Si rechaza:
   - status='rejected'
   - RELEASE wallet_hold (sin tocar balance)
```

**Por qué hold**: si el jugador apuesta entre que pidió retiro y se aprueba, no podría retirar lo ya gastado. El hold reserva.

---

## 8. Flujo: bet / win (game provider)

El game provider llama a nuestro backend vía wallet API (que nosotros exponemos al adapter). Operaciones típicas:

- `reserve` (debit): provider quiere apostar X. Backend valida + descuenta.
- `commit` (win): provider confirma resultado. Backend acredita ganancia.
- `rollback`: si falla algo en el provider, revertimos.

**Cada round genera 1+ filas en `wallet_transactions`** referenciando `game_round_id`. Volumen alto → tabla particionada por mes.

> Detalle del contrato con providers en `docs/07-integracion-aggregator.md`.

---

## 8.bis. Flujo: mint y burn (solo Admin Tenant)

El **Admin Tenant es el único usuario con capacidad de crear fichas**. Las fichas son una unidad contable interna; la conversión a fiat es responsabilidad del operador (banco / cripto). Por eso el Admin Tenant puede mintear cuanto quiera: la responsabilidad del payout real es suya.

### Reglas duras
- **Solo el rol `admin_tenant`** puede ejecutar `mint`/`burn`. Validado por permission guard + check explícito en el servicio.
- **2FA obligatorio** del actor.
- **`reason` obligatorio** con texto claro.
- **`funded_for` opcional** linkeando a la entidad que motiva el mint (bono, sorteo, liga, jackpot, fondeo de pool).
- Cualquier intento de mint desde otro rol → 403 + entrada en `audit_log` con severidad alta + alerta automática al super-admin.

### Flujo
```
1. Admin Tenant accede a "Mint" en su panel
2. Ingresa: monto + motivo + (opcional) referencia
3. 2FA challenge
4. Backend valida:
   - Rol exacto admin_tenant
   - 2FA correcto
   - reason no vacío
5. TRANSACCIÓN:
   - INSERT wallet_transactions (type='mint', wallet=admin, amount, reason, funded_for)
   - UPDATE wallets SET balance += amount WHERE admin
   - INSERT audit_log (action='wallet.mint', severity='high')
6. Notificación al super-admin (en tiempo real, sin bloquear)
7. Métrica "Total minteado del período" se actualiza
```

### Burn

Inverso. Solo para correcciones contables raras (devoluciones, errores de mint con monto incorrecto que ya no se puede arreglar con tx adicional). Mismas reglas duras.

### Por qué reportamos al super-admin

El super-admin (vos) cobra comisión sobre el NGR. El total minteado es un input crítico para detectar anomalías:
- Mucho mint sin actividad correspondiente → posible fraude del Admin Tenant.
- Mint en patrón sospechoso (ej: justo antes del cierre de período) → flag.

Reporte automático: "Total minteado del tenant por período + tx individuales".

---

## 9. Flujo: ajuste manual (`adjustment`)

Solo usuarios con `wallet.adjust`. Casos: corrección de errores, compensaciones, devoluciones por bugs.

- **Obligatorio**: `reason` con texto claro y trackeable.
- **2FA obligatorio** del actor.
- **Notificación automática** al admin del tenant cada vez que ocurre.
- Listado de adjustments aparece en panel destacado (radar de soporte).

---

## 10. Bonos y wagering

(Detalle a expandir cuando se implemente el módulo de promos.)

- Bono otorgado → entra a `wallet.locked_balance` (no `balance`).
- Apuestas mientras hay bono activo: se cumple wagering según reglas configuradas.
- Wagering cumplido → `bonus_clear` mueve a `balance`.
- Si el jugador retira antes de cumplir wagering → bono se cancela según política del tenant.

---

## 11. Idempotencia: implementación

Tabla `idempotency_keys` por tenant:
```
key             text PK
endpoint        text
request_hash    text
response_body   jsonb
status_code     int
created_at      timestamptz
expires_at      timestamptz       -- TTL configurable, ej. 24h
```

Middleware:
1. Si la key existe y `request_hash` coincide → devolver `response_body` cacheado.
2. Si la key existe y `request_hash` difiere → `409 IDEMPOTENCY_CONFLICT`.
3. Si no existe → procesar, al final guardar respuesta.

---

## 12. Conciliación

Job nocturno (configurable):
1. Suma todas las `wallet_transactions` del día por tenant.
2. Compara contra:
   - Total reportado por game providers.
   - Total de depósitos aprobados vs ingresos confirmados en cuentas bancarias / wallets cripto.
   - Total de retiros pagados vs egresos confirmados.
3. Discrepancia > umbral → alerta al admin del tenant + super-admin.
4. Reporte queda en `reconciliation_reports` (tabla a definir cuando se implemente).

---

## 13. Casos borde y mitigaciones

| Caso | Mitigación |
|---|---|
| Doble click en "cargar" | Idempotency key + debounce en UI |
| Crash del backend a mitad de tx | TX Postgres atómica → rollback automático |
| Provider devuelve `bet` 2 veces para mismo round | Constraint UNIQUE sobre `(provider_id, external_round_id, type)` |
| Jugador cancelado durante withdrawal pending | Hold se libera al cambiar status; balance no se afecta |
| Cambio de jerarquía con saldo en cajero | Job mueve saldo del cajero al nuevo superior con tx auditadas |
| Balance negativo "imposible" | Constraint `CHECK (balance >= 0)` y test de regresión |
| Drift por errores de redondeo | `numeric(20,2)`, nunca `float`. Tests de propiedad sobre operaciones |

---

## 14. Métricas operativas a monitorear

- Latencia p50/p95/p99 de operaciones wallet.
- Throughput de transacciones por segundo por tenant.
- Tasa de errores de idempotency conflict (puede indicar bug en cliente).
- Tamaño de cola de aprobaciones pendientes (depósitos/retiros).
- Discrepancias detectadas en conciliación.
- Adjustments por día (señal de problemas o fraude).
