# 04 · Modelo de Datos

> Estado: **decidido en estructura core**. Campos pueden ampliarse durante implementación. Cambios en relaciones requieren acuerdo.

Define las tablas principales y cómo se relacionan. Detalle de columnas se afina al implementar el schema en Drizzle (`packages/db`).

---

## 1. Distribución entre DBs

### DB de control (`platform_control`)

Una sola DB. Vive en `platform_control` y es accedida solo por código que necesita razonar sobre la plataforma global.

**Tablas:**
- `tenants`
- `tenant_domains`
- `tenant_branding_defaults`
- `tenant_plans`
- `platform_users` (super-admins)
- `platform_audit_log`
- `commission_settings`
- `commission_periods` (cierres)
- `commission_invoices`

### DB de tenant (`tenant_<slug>`)

Una por cliente. Mismo schema en todas (la migración es uniforme). Contiene **todo** lo operativo del tenant.

**Tablas:** ver §3.

---

## 2. DB de control — esquema

### `tenants`
```
id              uuid PK
slug            text unique           -- ej: 'casino-pampa'
name            text
db_name         text                  -- 'tenant_casino_pampa'
db_host         text                  -- por si se shardea a otro server
status          enum('active','suspended','onboarding','deleted')
plan_id         uuid FK
contact_email   text
created_at      timestamptz
deleted_at      timestamptz nullable
```

### `tenant_domains`
```
id              uuid PK
tenant_id       uuid FK
domain          text unique           -- 'casinopampa.com', 'app.casinopampa.com'
is_primary      bool
verified_at     timestamptz nullable
```
> Un tenant puede tener varios dominios (panel + sitio público + alias).

### `tenant_plans`
```
id, code, name, commission_pct, features (jsonb), monthly_fee, ...
```

### `platform_users`
Super-admins. Email + password hash + 2FA secret + permisos `platform.*`.

### `commission_settings` / `commission_periods` / `commission_invoices`
Define el cálculo del % netwin que cobra el dueño de la plataforma a cada tenant. Cierre periódico (configurable: diario/semanal/mensual). Genera factura interna.

### `platform_audit_log`
Toda acción del super-admin queda acá. Inmutable.

---

## 3. DB de tenant — esquema core

### Identidad y jerarquía

#### `users`
```
id                  uuid PK
username            text unique
email               text unique nullable      -- jugadores pueden no tener email
phone               text nullable
password_hash       text
status              enum('active','suspended','banned','pending')
two_fa_secret       text nullable
last_login_at       timestamptz
created_by          uuid FK users(id) nullable
created_at          timestamptz
metadata            jsonb                     -- flags varios
```

#### `roles`
```
id, code, name, description, is_system, created_at
```
Seed inicial: `admin_tenant`, `socio`, `distribuidor`, `cajero`, `empleado`, `usuario_final`.

#### `permissions`
```
code             text PK            -- 'wallet.load'
category         text               -- 'wallet'
description      text
audit_required   bool               -- la acción debe loggearse en audit_log
is_delegatable   bool               -- si quien lo tiene puede otorgárselo a un subordinado
```
Catálogo igual en todos los tenants (mantenido por código). Ver `docs/03-jerarquia-roles.md §7` para reglas de delegación.

#### `role_permissions`
```
role_id, permission_code (PK compuesta)
```

#### `user_roles`
```
user_id, role_id (PK compuesta)
granted_by, granted_at
```

#### `user_permission_overrides`
```
user_id, permission_code (PK compuesta)
effect              enum('grant','revoke')
granted_by          uuid FK users(id)        -- quien otorgó/revocó directamente
granted_by_chain    uuid[]                   -- cadena de delegación desde el origen (para cascada)
granted_at, reason
```
> `granted_by_chain` permite cascada al revocar: si se revoca un permiso a un usuario X, se revocan automáticamente todos los overrides cuya cadena contiene a X. Ver `docs/03-jerarquia-roles.md §7.3`.

#### `user_hierarchy`
```
user_id         uuid FK
parent_user_id  uuid FK nullable
relation_type   text                -- 'cajero_de_distribuidor', etc.
since           timestamptz
until           timestamptz nullable
```
> Histórica: cada cambio de jerarquía cierra el registro anterior (`until`) y abre uno nuevo. Permite reconstruir relaciones en el pasado.

---

### Wallet (fichas)

#### `wallets`
```
id              uuid PK
user_id         uuid FK unique
balance         numeric(20,2)        -- fichas, no plata
locked_balance  numeric(20,2)        -- bonos con wagering pendiente, holds
currency        text                 -- siempre 'CHIPS' en MVP
version         int                  -- optimistic locking
updated_at      timestamptz
```
> Una wallet por usuario. Jugadores, cajeros, todos. Diferencia operativa: el cajero **transfiere** desde su wallet, no la consume él jugando.

#### `wallet_transactions` (inmutable)
```
id                  uuid PK
wallet_id           uuid FK
type                enum  -- 'mint','burn','load','unload','transfer_in','transfer_out',
                          -- 'bet','win','rollback','adjustment','bonus_grant','bonus_clear',
                          -- 'bonus_forfeit','deposit','withdrawal','jackpot_win',
                          -- 'promo_reward','league_reward','commission_payout','fund_reserve','fund_release'
amount              numeric(20,2)    -- siempre positivo; 'type' indica dirección
balance_after       numeric(20,2)
related_tx_id       uuid nullable    -- para pares (transfer_in ↔ transfer_out, mint ↔ bonus_grant)
counterparty_user   uuid nullable    -- contraparte humana si aplica
source              text             -- 'cashier_panel','deposit_flow','game_provider:pragmatic','admin_mint',...
reference_id        uuid nullable    -- id de la entidad que originó (deposit_id, game_round_id, bonus_id, promo_id, league_id, etc.)
idempotency_key     text unique nullable
created_by          uuid FK users(id) nullable   -- actor
created_at          timestamptz
notes               text nullable
```
> **Append-only**. Nunca se actualiza ni se borra. Ajustes/rollbacks son nuevas filas.

##### Tipos especiales

- **`mint`**: solo Admin Tenant. Crea fichas desde la nada en su wallet. `reason` obligatorio. Cada mint queda en `wallet_transactions` y se contabiliza en el reporte "Total minteado por período" del super-admin.
- **`burn`**: solo Admin Tenant. Destruye fichas de su wallet. Para correcciones contables.
- **`fund_reserve` / `fund_release`**: hold/release de fichas comprometidas para premios futuros (ver `promo_fund_reservations`).
- **`bonus_forfeit`**: bono cancelado antes de cumplir wagering. Las fichas se retornan al funder original (otra tx `transfer_in` en su wallet).

> Solo el rol `admin_tenant` (validado en backend) puede ejecutar `mint`/`burn`. Cualquier otro intento → 403 + entrada en `audit_log` con flag de severidad alta.

#### `wallet_holds`
```
id, wallet_id, amount, reason, expires_at, released_at, related_entity_type, related_entity_id
```
> Para retiros pendientes, bonos en wagering, **reservas de fondos para premios** (sorteos, liga). Evita doble-gasto.

#### `promo_fund_reservations`
Tabla específica para fondos comprometidos por promos con premio fijo (sorteos, liga, jackpots propios, misiones con premio fijo). Permite trackear quién financió qué y revertir si se cancela.

```
id                   uuid PK
funder_user_id       uuid FK users(id)         -- quien paga (Admin Tenant, Socio, etc.)
funded_on_behalf_of  uuid FK users(id) nullable -- empleado actor si fue creada por delegación
entity_type          enum('promotion','league','tenant_jackpot','mission_pool','referral_bonus_pool')
entity_id            uuid                       -- id de la promoción/liga/etc.
amount_total         numeric(20,2)              -- monto total reservado
amount_consumed      numeric(20,2)              -- usado al entregar premios
amount_returned      numeric(20,2)              -- devuelto si se canceló parcial
hold_id              uuid FK wallet_holds       -- hold sobre la wallet del funder
status               enum('reserved','partially_consumed','fully_consumed','cancelled','returned')
created_at, closed_at nullable
```

> Cuando el creador de la promo no es Admin Tenant: se valida saldo del funder ≥ amount_total, se hace `fund_reserve` (hold) en su wallet. Al entregar premios → `fund_release` parcial + tx wallet al ganador. Al cancelar → release completo, fichas vuelven al funder.
> Cuando el creador es Admin Tenant: se hace `mint` directo por el monto (no hay hold porque es ilimitado), pero igual se crea reserva conceptual para auditoría.

---

### Depósitos (carga autoservicio del jugador)

#### `deposits`
```
id              uuid PK
user_id         uuid FK
amount_fiat     numeric(20,2)
currency_fiat   text                 -- 'ARS', 'USDT'
amount_chips    numeric(20,2)        -- equivalente en fichas
method_id       uuid FK payment_methods
status          enum('pending','under_review','approved','rejected','expired','cancelled')
receipt_url     text nullable        -- comprobante en S3
external_ref    text nullable        -- hash cripto, nro operación banco
assigned_to     uuid FK users nullable    -- cajero/empleado que lo gestiona
reviewed_by     uuid FK users nullable
reviewed_at     timestamptz nullable
rejection_reason text nullable
wallet_tx_id    uuid FK wallet_transactions nullable   -- si se aprobó, qué tx generó
created_at, updated_at
```

#### `deposits_audit`
Cambios de estado del depósito (timeline visible al usuario).

---

### Retiros

#### `withdrawals`
```
id, user_id, amount_chips, amount_fiat, currency_fiat,
method_id, target_account (jsonb)   -- CBU, alias, wallet cripto
status enum('pending','approved','rejected','processing','paid','failed')
hold_id FK wallet_holds              -- mientras está pending, las fichas están en hold
processed_by, processed_at, paid_external_ref, ...
```

---

### Métodos de pago (configurable por tenant)

#### `payment_methods`
```
id, code, name, type enum('bank_transfer','crypto','other'),
config jsonb,         -- CBU, wallet address, exchange config
is_active, created_at
```
Cada tenant define los suyos. No hay catálogo global.

---

### Juegos / Apuestas

#### `game_providers`
```
id, code, name, adapter_class, config jsonb, is_active
```

#### `games`
```
id, provider_id, external_id, name, category, thumbnail_url,
rtp, volatility, is_active, sort_order
```

#### `game_sessions`
```
id, user_id, game_id, started_at, ended_at, total_bet, total_win, status
```

#### `game_rounds`
```
id, session_id, external_round_id, bet_amount, win_amount,
provider_payload jsonb, settled_at
```
> Append-only. Cada round es 1 fila. Particionado por mes recomendado para volumen.

---

### Auditoría

#### `audit_log`
```
id                   uuid PK
actor_user_id        uuid FK users(id) nullable    -- nullable solo para acciones de sistema
actor_role_at_time   text                          -- snapshot del rol al momento
action_code          text                          -- ej: 'wallet.load', 'permission.grant'
target_type          text                          -- 'user', 'wallet', 'deposit', etc.
target_id            uuid nullable
before               jsonb                         -- snapshot del estado previo (campos relevantes)
after                jsonb                         -- snapshot posterior
ip                   inet                          -- IP del actor
user_agent           text
request_id           uuid                          -- correlación de toda la cadena de llamadas (1 request HTTP = 1 request_id)
session_id           uuid nullable                 -- sesión del actor
impersonator_id      uuid FK users(id) nullable    -- si fue ejecutado en modo impersonate
reason               text nullable                 -- obligatorio para acciones destructivas
metadata             jsonb                         -- contexto extra específico del action_code
created_at           timestamptz                   -- precisión ms
```
> **Inmutable**. REVOKE UPDATE/DELETE a nivel Postgres role. Particionada por mes.
> Toda acción significativa **debe** loggearse acá. Reglas en `docs/12-seguridad-compliance.md`. Granularidad y filtros del panel en `docs/10-panel-control.md`.

---

### Marketing / Referidos

#### `referral_codes`
```
id, owner_user_id, code text unique, custom_url_slug nullable,
landing_page_id nullable, expires_at nullable, is_active, created_at
```

#### `referral_attributions`
```
user_id (referido), referral_code_id, attributed_at,
first_touch_url, last_touch_url, utm jsonb
```

#### `campaigns`
```
id, owner_user_id, name, status, channel, budget,
starts_at, ends_at, config jsonb (creatives, audience filters)
```

#### `campaign_metrics` (agregadas por día)
```
campaign_id, date, impressions, clicks, signups, ftd_count, ftd_volume, netwin_attributed
```

---

### Soporte / Livechat

#### `livechat_threads`
```
id, user_id, kommo_lead_id, status, assigned_to,
opened_at, closed_at, last_message_at
```
> Espejo local de conversaciones de Kommo para joins rápidos con métricas.

#### `livechat_messages`
```
id, thread_id, sender_type, sender_id, body, sent_at, kommo_msg_id
```

---

### Branding por tenant

#### `branding_settings` (singleton por DB de tenant)
```
id, primary_color, secondary_color, accent_color,
logo_url, favicon_url, font_family,
hero_image_url, theme_mode, custom_css text nullable,
copy_overrides jsonb,
updated_by, updated_at
```

---

### Configuración general del tenant

#### `tenant_settings` (singleton)
```
id, default_locale, timezone, currency_display,
chip_to_fiat_rate, kyc_level enum('none','basic','full'),
2fa_required_roles text[],
deposit_min, deposit_max, withdrawal_min, withdrawal_max,
period_close_strategy enum('daily','weekly','monthly'),
features jsonb        -- flags activables
```

---

## 4. Convenciones generales

| Convención | Detalle |
|---|---|
| PKs | `uuid v7` (ordenable por tiempo, mejor para índices que v4). |
| Timestamps | Todos en `timestamptz`, almacenados en UTC. |
| Naming | Tablas en plural snake_case. Columnas snake_case. Nada de camelCase en SQL. |
| Soft delete | Solo donde tenga sentido (`tenants`, `users`). El resto es histórico inmutable. |
| Numéricos financieros | `numeric(20,2)`. **Nunca `float`/`double`.** |
| Enums | Postgres enums **solo** para sets cerrados estables. Para sets que pueden crecer, usar `text` + check constraint o tabla lookup. |
| Índices | Todo FK debe tener índice. Reportes pesados → índices compuestos justificados. |
| Particionado | `wallet_transactions`, `game_rounds`, `audit_log` particionadas por mes desde el inicio (RANGE partitioning). |

---

## 5. Reglas de integridad

1. **Toda mutación de `wallets.balance` ocurre en una transacción que también inserta en `wallet_transactions`**. Sin excepciones. Trigger opcional para forzarlo.
2. `wallet_transactions` y `audit_log` son **append-only**. REVOKE UPDATE/DELETE a nivel de Postgres role para usuarios de la app.
3. `idempotency_key` es UNIQUE → reintentos seguros.
4. Borrado de un usuario (raro): nunca DELETE físico. Marcar `status = 'deleted'`, anonimizar PII, mantener histórico financiero intacto.
5. **`mint` y `burn` solo permitidos al rol `admin_tenant`**. Validado por permission guard + check explícito en el servicio de wallet.
6. **Toda promo con premio fijo requiere `promo_fund_reservations` activa antes de empezar**. Sin reserva → la promo no se puede crear ni publicar.

---

## 5.bis. Cálculo de NGR y comisión del super-admin

Métricas financieras claves del tenant. Se calculan por período (configurable: diario / semanal / mensual).

### Definiciones

```
GGR (Gross Gaming Revenue) = Σ wallet_transactions.amount WHERE type='bet'
                           − Σ wallet_transactions.amount WHERE type='win'
                           − Σ wallet_transactions.amount WHERE type='rollback' (signo según contexto)

Bonus cost                 = Σ wallet_transactions.amount WHERE type IN ('bonus_grant','bonus_clear','promo_reward','league_reward','jackpot_win')
                             AND funded_by = admin_tenant
                             (solo bonos/premios financiados por el tenant; los del Socio NO entran)

Provider fees              = Σ comisiones de game providers (calculado por adapter)

NGR (Net Gaming Revenue)   = GGR − Bonus cost − Provider fees

Comisión super-admin       = NGR × commission_pct  (configurada en platform_control.commission_settings)
```

### Por qué los bonos del Socio no entran al cálculo

Si un Socio paga un bono de su saldo, las fichas no se "imprimieron"; venían de cargas previas que el Admin Tenant ya pagó (en fiat, eventualmente). Restar esos bonos del NGR sería doble-conteo. Solo se restan los bonos cuyo `funded_by = admin_tenant` (es decir, fichas que efectivamente se mintean para promo).

### Cierre de período

Job programado por tenant:
1. Calcula GGR, Bonus cost, Provider fees, NGR para el período.
2. Genera `commission_invoices` en la DB de control (super-admin).
3. Snapshot inmutable de la cifra (no se recalcula post hoc aunque se modifiquen tx).
4. Notifica a Admin Tenant + super-admin.
5. Estado de la factura: `pending` → `paid` / `disputed`.

---

## 6. Volumen previsto y estrategia

| Tabla | Volumen estimado (por tenant medio, 1 año) | Estrategia |
|---|---|---|
| `users` | 10k–100k | Índices estándar |
| `wallet_transactions` | 1M–50M | Particionado mensual + índice compuesto `(wallet_id, created_at)` |
| `game_rounds` | 10M–500M | Particionado mensual + archivado fríos a >12 meses |
| `audit_log` | 1M–20M | Particionado mensual + retención configurable |
| `deposits` / `withdrawals` | 100k–1M | Índices por status y created_at |

Si un tenant excede umbrales, se mueve su DB a un host dedicado (sharding por tenant ya está soportado por diseño).

---

## 7. Pendientes

- Decidir esquema concreto de `bonuses` y `wagering` (lo dejamos para cuando armemos el módulo de promos).
- Esquema de notificaciones (in-app, email, push) — definir en su propio doc cuando se implemente.
- Esquema de logs de eventos analíticos (clicks, vistas) — probablemente warehouse separado, no Postgres.
