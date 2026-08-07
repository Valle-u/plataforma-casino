# 15 · Engagement: Bonos, Sorteos / Actividades y Liga

> ⚠️ PENDIENTE de redefinir tras docs/LEYES.md (2026-07-07). Este doc precede al split dependiente/independiente, al aislamiento (E8/P3) y al modelo de comisión diferencial (C1). NO tratar como vigente hasta redefinir engagement/referidos con el dueño.

> **Nota Sprint 59 (2026-08-07, decidido con el dueño)**: las planillas de **monto fijo** (`manual` → `config.defaultAmount`, `no_deposit` → `config.amount`) se respetan EXACTAMENTE en ambos flujos: al aprobar un depósito (acredita el monto fijo en `bonus_balance`) y en el grant manual (el monto debe ser igual a la planilla; no se puede cargar otro). El approve de depósitos solo ofrece planillas aptas (`welcome`/`reload` = %, `manual`/`no_deposit` = fijo). Cálculo único en `apps/api/src/bonuses/bonus-amount.ts`. Esto reemplaza la regla previa "manual = monto sugerido editable".

> Estado: **decidido en estructura**. Tipos específicos de cada feature pueden ampliarse al implementar.

Este doc cubre tres módulos relacionados pero independientes en datos:

1. **Bonos** — créditos especiales con reglas de wagering.
2. **Sorteos / Actividades** — sorteos por tickets/ranking, misiones, ruleta diaria, login streak, cofres.
3. **Liga / Rankings** — leaderboards multi-período con premios automáticos.

Y un sistema **antifraude transversal** de detección de cuentas múltiples.

---

## 0. Principios

| Principio | Implicación |
|---|---|
| **Trazabilidad financiera** | Todo crédito/débito por bono/sorteo/liga genera `wallet_transaction` específica con `source` claro. |
| **El que otorga paga (red independiente) / Tesorería paga (red dependiente)** | Las fichas de un bono otorgado manualmente salen del **saldo del usuario que lo otorga** en la **red independiente** (LEYES R3/R4, cambio autorizado por el dueño 2026-07): si un cajero otorga con la planilla de su socio, debita su propia wallet, no la del socio. En la **red dependiente** el grant sigue siendo **admin-only** y lo paga la **tesorería (`__casa__`)** (LEYES E3, autorizado por el dueño 2026-07-31) — el admin no tiene saldo propio; su plata vive en la Casa. En **auto-grant** (welcome/reload tras depósito aprobado) y **cashback** de planillas del admin también paga la Casa. Esto alinea incentivos y elimina fraudes de "regalar plata ajena". |
| **Reserva inmediata para premios fijos** | Sorteos / liga / jackpots propios con premio definido reservan los fondos al crearse (`promo_fund_reservations`). Si el creador no tiene saldo, no se puede crear. |
| **Cobro al entregar para premios eventuales** | Bonos disparados por evento abierto (welcome universal, FTD, cashback) se debitan en el momento del otorgamiento. Si el funder se queda sin saldo → flag "pool agotado", no se otorga, se notifica. (No aplica al Admin Tenant porque paga la Casa.) |
| **Reverso al funder** | Si una promo se cancela / expira / un bono se forfeit, las fichas vuelven al funder original (no al tenant). Para planillas del admin, el funder es la Casa → el reverso vuelve a la Casa. |
| **Solo usuarios finales** | El `bonus_balance` es **exclusivo de jugadores** (LEYES R8, dueño 2026-07-31). Ningún operador recibe bonos: el backend rechaza el grant con `BONUS_TARGET_NOT_PLAYER` y el UI no ofrece la acción. La limpieza histórica corrió con la migración `0075_bonus_wallet_players_only`. |
| **Reglas automáticas desactivables** | Cada regla automática (cashback, login streak, ruleta diaria, welcome, etc.) tiene flag `is_active` toggleable en cualquier momento, sin perder histórico. Toda activación/desactivación queda en `audit_log`. |
| **Auditoría granular** | Toda creación/edición/cancelación/otorgamiento queda en `audit_log` (ver `docs/04-modelo-datos.md` y `docs/03-jerarquia-roles.md §7.6`). |
| **Configurable por Admin Tenant** (default) | El Admin Tenant configura todo desde su panel. El Socio ve resultados filtrados a su red. En v2: el Socio puede crear sus propias promos con su propio funding. |
| **Antifraude integrado** | Detección de cuentas múltiples reusable entre módulos. |

### Resolución del funder

Al crear una promo o al otorgar un bono, el sistema resuelve quién paga:

| Contexto | Funder |
|---|---|
| Grant manual · red dependiente (admin-only) | **Tesorería (`__casa__`)** — LEYES E3 (dueño 2026-07-31). `def.fundedByUserId` es el creador (Admin Tenant); el debit efectivo se redirige a la wallet de la Casa |
| Grant manual · red independiente (socio, distribuidor o cajero de la sub-red) | **El actor que otorga** (debita su propia wallet — LEYES R3/R4) |
| Auto-grant (welcome/reload tras depósito aprobado) | `def.fundedByUserId`; si es Admin Tenant → **Tesorería (`__casa__`)** |
| Cashback de planilla del admin | `def.fundedByUserId` (Admin Tenant) → **Tesorería (`__casa__`)** |
| Empleado del tenant (comodín, `*_admin_network`) | `def.fundedByUserId` — Admin Tenant → **Tesorería (`__casa__`)** |
| Prize kind=bonus en promo/liga | Funder de la `bonus_definition`; si es Admin Tenant → **Tesorería (`__casa__`)** |

Esto se guarda en `bonus_definitions.funded_by_user_id` (resuelto al crear, es el
funder **nominal**) y en `user_bonuses.funded_by_user_id` (resuelto al otorgar,
puede diferir del de la planilla en la red independiente y **es el id de la Casa**
para planillas del admin — de ahí salen y a donde revierten los reversos).
Validación al crear: el funder debe tener saldo suficiente (o ser admin_tenant).

> **Selector del grant modal**: el `GrantBonusModal` solo muestra planillas que el
> actor puede otorgar. El admin_tenant (y empleados con el comodín
> `bonuses.grant_manual_admin_network`) ven únicamente las del tenant
> (`?ownerScope=tenant`); las de ramas independientes quedan reservadas a la
> sub-red de su socio (el backend las rechaza con `BonusOutOfBranchScopeError` →
> 403). Para socios independientes y su red el backend auto-filtra por branch
> owner (`autoScopeOwner`).

---

# Sección A · Bonos

## A1. Tipos de bono soportados (MVP completo)

| Tipo | `bonus_definitions.type` | Descripción |
|---|---|---|
| Bienvenida | `welcome` | Al primer depósito. Match % hasta tope. Configurable. |
| Por depósito recurrente | `reload` | Match % en depósitos siguientes. Reglas por nivel/segmento. |
| Cashback | `cashback` | % del netwin perdido en período X devuelto como bono. |
| Manual | `manual` | Cajero/empleado lo otorga, motivo obligatorio. |
| Free spins | `free_spins` | N giros en juegos específicos sin costo. |
| Sin depósito | `no_deposit` | Regalo al registrarse. Wagering típicamente alto. |
| Por referido | `referral` | Otorga al socio/referido cuando se cumple condición. |

## A2. Wagering (rollover)

Configuración por bono (`bonus_definitions.wagering`):

```jsonc
{
  "multiplier": 20,                    // x veces a apostar
  "base": "bonus" | "bonus+deposit",   // sobre qué se calcula
  "contributions": {
    "slots": 1.0,                      // 100%
    "live": 0.10,                      // 10%
    "table": 0.20,
    "sportsbook": 0.0
  },
  "excluded_games": ["uuid1","uuid2"], // juegos que no cuentan
  "max_bet_during_wagering": 500       // bet máximo permitido mientras hay wagering activo
}
```

## A3. Modelo de datos

```
bonus_definitions
  id, code, name, type, status enum('draft','active','paused','archived')
  config jsonb            -- match_pct, max_amount, min_deposit, etc.
  wagering jsonb          -- ver A2
  expiration_days int
  segment_filter jsonb    -- target audience
  visibility jsonb        -- dónde se muestra (banner, popup, sección)
  scope enum('tenant')    -- siempre tenant en MVP (no hay platform-wide)
  created_by, created_at, updated_at

user_bonuses                       -- instancia del bono asignado a un user
  id, user_id, definition_id,
  granted_amount numeric(20,2),
  remaining_amount numeric(20,2),
  status enum('pending','active','wagering','cleared','cancelled','expired','forfeited')
  granted_at, activated_at, cleared_at, expires_at
  granted_by uuid nullable        -- usuario actor si fue manual
  source_event jsonb              -- 'deposit_id', 'registration', 'manual', etc.

bonus_progress                     -- tracking de wagering
  user_bonus_id, total_required, total_completed,
  bets_count, last_updated_at

bonus_audit                        -- timeline (también en audit_log)
  id, user_bonus_id, event, payload jsonb, created_at
```

## A4. Estados — máquina

```
       creado / asignado
            │
            ▼
        pending  ──(usuario opt-in / auto)──▶  active
            │                                    │
            │                              (aposta primer bet)
            │                                    ▼
            │                              wagering_in_progress
            │                                    │
            │            ┌───────────────────────┤
            │            │                       │
        cancelled    cleared                 expired
        forfeited    (wagering cumplido →   (TTL)
        (cancela     pasa a balance real)
         antes de
         cumplir)
```

Reglas:
- **Cancelación antes de cumplir**: configurable por bono. Default: ganancias generadas con bono se pierden (`forfeited`).
- **Múltiples bonos activos**: configurable. Default 1 por usuario por vez. Si llega un segundo → entra `pending` y espera.
- **Expiración**: días configurables (default 30). Job nocturno cierra los expirados.

## A5. Panel "Bonos Activos" (control del tenant)

Pantalla crítica para evitar problemas. Mostrar:

- **KPI top**: cantidad de bonos activos, total comprometido (sumatoria), wagering pendiente total.
- **Alerta si total comprometido > umbral configurable** (% del balance del tenant).
- **Listado** filtrable por:
  - Tipo de bono
  - Estado
  - Segmento
  - Usuario / Socio / Cajero asignado
  - Rango de monto
- **Por fila**: usuario, bono, monto otorgado, % wagering cumplido, expira en, ganancias generadas, riesgo flag.
- **Acciones**: cancelar, forzar-clear (con permiso especial + 2FA), exportar.
- **Vista de "riesgo"**: bonos con patrones sospechosos (ver A7).

## A6. Otorgamiento

Triggers:
- **Auto**: depósito aprobado dispara welcome/reload si el usuario califica (job inmediato).
- **Auto periódico**: cashback se calcula al cierre del período (job nocturno/semanal).
- **Manual**: cajero/empleado con permiso `bonuses.grant_manual` lo otorga, motivo obligatorio. Aparece en panel del jugador.
- **Sistema**: registro otorga `no_deposit` si está activo.
- **Por referido**: aprobación de FTD del referido dispara el bono al referente y/o referido según política.

## A7. Antifraude de bonos

Señales que marcan riesgo (NO bloquean automático, alertan):
- Patrón "deposit, cumple wagering mínimo, retira" muy rápido.
- Apuesta siempre cerca del `max_bet` permitido durante wagering (max-betting).
- Múltiples cuentas con misma IP/dispositivo aprovechando welcome.
- Cashback solicitado consistentemente en pérdidas justas (posible coordinación con segunda cuenta).

Ver §D para sistema antifraude transversal.

---

# Sección B · Sorteos / Actividades

## B1. Tipos soportados (MVP completo)

| Tipo | `promotions.type` | Descripción |
|---|---|---|
| Sorteo por tickets | `lottery_tickets` | Cada N fichas apostadas en juegos elegibles = 1 ticket. Sorteo en fecha X. |
| Sorteo por ranking | `lottery_ranking` | Top N de un período se reparten premios. |
| Misiones / desafíos | `missions` | Objetivo + período. Cumple → premio. |
| Ruleta diaria | `daily_wheel` | 1 spin/día/usuario. Premios + probabilidades configurables. |
| Login streak | `login_streak` | Premios crecientes por días seguidos. |
| Cofres por nivel | `level_chests` | XP por actividad → niveles → cofres con premios. |

## B2. Modelo de datos (genérico)

```
promotions
  id, code, name, type, status enum('draft','scheduled','active','closed','cancelled')
  config jsonb          -- específico del type
  starts_at, ends_at, draw_at nullable
  target_segment jsonb  -- filtro de elegibles
  visibility jsonb      -- banner home / sección / popup / múltiple
  prizes jsonb          -- estructura de premios (escalonado)
  scope enum('tenant')  -- MVP solo tenant
  created_by, created_at

promotion_participants
  promotion_id, user_id, joined_at, current_progress jsonb

promotion_tickets               -- para lottery_tickets
  id, promotion_id, user_id, ticket_number, generated_from_round_id, created_at

promotion_rewards               -- entregas de premios (link con wallet_tx)
  id, promotion_id, user_id, position int nullable, prize jsonb,
  wallet_tx_id, granted_at

promotion_audit
  id, promotion_id, event, actor_user_id, payload, created_at
```

## B3. Sorteo por tickets

- Configuración: ratio `chips_apostados → 1 ticket`, juegos elegibles, período de generación, fecha de draw, premios.
- Tickets se generan **en tiempo real** al cerrarse cada round (job rápido).
- Draw: algoritmo verificable con seed pública.
  - Al cerrar el período, se publica el `seed_hash` (commit).
  - Tras el draw, se publica el `seed` (reveal). Permite a cualquiera reproducir el sorteo.
- Notificación a ganadores + premio en wallet.

## B4. Sorteo por ranking

- Métrica configurable: total apostado, total ganado, rounds, score combinado.
- Período configurable.
- Top N gana premios escalonados.
- Mismo criterio antifraude que la liga (ver §C5).

## B5. Misiones

- Objetivo: *"Apostá X en categoría Y antes de Z"*, *"Jugá N rounds en juegos del proveedor P"*, etc.
- Progreso visible al jugador (barra de progreso, ítems).
- Completar → premio (bono / fichas / spins / ticket de sorteo).
- Misiones encadenadas (cadena de N misiones, completar todas da premio mayor).

## B6. Ruleta diaria (`daily_wheel`)

- Configurable: segmentos del wheel (premio + probabilidad).
- 1 spin/día/usuario por default; configurable (extra spin como recompensa de misión, etc.).
- Premios típicos: fichas, free spins, "intentá otra vez", bono pequeño.
- Auditoría de cada spin: usuario, segmento ganado, RNG seed (verificable).

## B7. Login streak

- Configurable: premios por día (1, 2, 3, ..., N).
- Reset si se rompe el streak (configurable: hard reset o "perdón" de 1 día).
- Visible en UI: "día 3 de 7 — premio de hoy: 50 fichas".

## B8. Cofres por nivel

Sistema de XP simple:
- Cada actividad (apuesta, depósito, login) da XP configurable.
- Niveles (`levels`): umbrales de XP. Cada nivel desbloquea un cofre.
- Cofre: premio aleatorio dentro de un loot table configurado.
- Niveles **no se pierden**, son acumulativos.

> XP system es módulo nuevo. En MVP puede ser una tabla simple `user_xp` con triggers en eventos clave. Se refina en v2.

## B9. Visibilidad y dónde se muestra

Cada `promotion.visibility` define dónde aparece:
- `banner_home: true/false`
- `dedicated_section: true/false`
- `popup_login: true/false`
- `notification: true/false`
- `target_panel_path: '/promociones/<slug>'`

El **Admin Tenant** decide al crear. Soporta múltiples ubicaciones simultáneas.

## B10. Quien crea / quién ve

- **Admin Tenant**: crea, edita, cancela. Es el dueño del módulo.
- **Empleado del tenant** con permiso `promotions.create` puede crear/editar.
- **Socio**: ve resultados filtrados a su red ("De tus 230 referidos, 47 tienen tickets activos. Tu top: Pepe con 15 tickets").
- **Distribuidor / Cajero**: ven métricas de sus jugadores.
- **Usuario**: ve las promos elegibles y su propio progreso.

---

# Sección C · Liga / Rankings

## C1. Períodos

Soportados simultáneamente:
- **Diario** (cierra a las 00:00 hora del tenant)
- **Semanal** (lunes 00:00)
- **Mensual** (día 1, 00:00)
- **Temporada** (configurable, ej. 3 meses)

Un usuario participa de los 4 a la vez con la misma actividad.

## C2. Métricas rankeables

- `bet_volume` — total apostado (chips)
- `rounds_count` — cantidad de rounds jugados
- `gross_won` — total ganado bruto
- `player_netwin` — neto (ganó − perdió) **del jugador**
- `score_custom` — fórmula configurable, ej. `0.7 * bet_volume + 0.3 * rounds_count`

Multi-tabla: el Admin Tenant puede activar varias ligas con distintas métricas en paralelo (ej: "Liga del apostador" por volumen + "Liga del afortunado" por gross won).

## C3. Modelo de datos

```
leagues
  id, code, name, period enum('daily','weekly','monthly','season','custom'),
  metric enum('bet_volume','rounds_count','gross_won','player_netwin','score_custom'),
  metric_config jsonb,         -- fórmula si es custom
  prizes jsonb,                -- por posición {1: {...}, '2-5': {...}, '6-10': {...}}
  starts_at, ends_at,
  status enum('scheduled','active','closed'),
  visibility jsonb,
  created_by, created_at

league_standings              -- snapshot vivo, recalculado periódicamente
  league_id, user_id, score numeric(20,4), position int, last_updated_at
  PK (league_id, user_id)

league_results                -- al cerrar, se persiste resultado final
  league_id, user_id, final_position, final_score, prize jsonb,
  wallet_tx_id nullable, settled_at
```

Recalculo:
- En tiempo real **suficiente**: actualizar `league_standings` cada N minutos por job (ej. cada 5 min para semanal, cada 1 min para diario).
- Top 10 cacheado en Redis con TTL corto.
- Para cierre: snapshot final transaccional + pago automático de premios.

## C4. Premios automáticos

Configurables por posición:
```jsonc
{
  "1":     { "type": "chips", "amount": 100000 },
  "2":     { "type": "bonus", "definition_id": "uuid", "amount_override": 50000 },
  "3":     { "type": "chips", "amount": 25000 },
  "4-10":  { "type": "free_spins", "count": 50, "game_id": "uuid" },
  "11-50": { "type": "chips", "amount": 1000 }
}
```

Al cerrar período → job:
1. Lee `league_standings` ordenado.
2. Para cada posición premiada → aplica premio (wallet_tx, otorga bono, etc.).
3. Inserta en `league_results`.
4. Notifica a ganadores.

## C5. Visibilidad

- **Username real** mostrado.
- Solo logueados pueden ver.
- **Top 10** + posición del usuario actual con ventana ("46. Juan, 47. **Vos**, 48. Pedro").
- Premios visibles públicamente (transparencia).
- Histórico de períodos cerrados navegable.

## C6. Antifraude (multi-cuenta)

- Cuentas marcadas como "duplicado probable" por el sistema antifraude (§D) **no entran** al ranking.
- Cajeros, distribuidores, empleados del tenant **excluidos** por default. Configurable.
- Señales adicionales específicas de liga:
  - Cuenta con score altísimo en período pero ningún round propio (heredado de bonos): excluir.
  - Solo apuestas en juegos con bajo house edge (anti-min-edge gaming): flag.

## C7. Quién crea / quién ve

- **Admin Tenant**: crea ligas, define premios, cierra manualmente si hace falta.
- **Socio**: ve ranking filtrado a su red ("En la liga semanal, tu top de la red: Juan (#5 global, #1 en tu red)"). Pueden tener un **mini-ranking interno** de su red expuesto a sus referidos si el Admin lo permite.
- **Distribuidor / Cajero**: ve ranking de sus jugadores.
- **Usuario**: ve liga global (top 10 + su posición).

---

# Sección D · Sistema antifraude transversal: detección de cuentas múltiples

Reutilizable por liga, sorteos por ranking, bonos de bienvenida, y cualquier feature donde importe "una persona = una cuenta".

## D1. Señales

### Identidad
- IP compartida (>1 cuenta desde misma IP en X tiempo).
- Device fingerprint coincidente (canvas, fonts, hardware, etc. — librería tipo FingerprintJS).
- Geo coincidente persistente.
- User agent + language exacto.

### Datos de contacto
- Email similar (Levenshtein < umbral, mismo dominio + variantes).
- Teléfono igual o "vecino" (último dígito distinto).
- Misma cuenta bancaria / wallet cripto en depósitos.
- Nombres similares + DNI/CUIT relacionados.

### Comportamiento
- Patrón de juego idéntico (horarios, juegos, montos).
- Sesiones que nunca se solapan en el tiempo (claro signo de single operator).
- Depósitos en patrón coordinado (uno deposita, otro retira; rebote).

### Red
- Misma red WiFi (subred IP) en bloque.
- VPN/proxy detectado + flags de país inesperado.

## D2. Modelo de datos

```
fraud_signals                     -- señales crudas detectadas
  id, user_id, signal_type, payload jsonb, weight numeric, detected_at

fraud_account_links               -- pares de cuentas vinculadas
  user_a_id, user_b_id (siempre user_a < user_b), score numeric,
  signals jsonb,                  -- desglose de qué señales aportaron
  status enum('suspected','confirmed','dismissed'),
  reviewed_by, reviewed_at, last_updated_at

fraud_clusters                    -- agrupación de N cuentas vinculadas (transitividad)
  id, user_ids uuid[], score, status, ...
```

## D3. Score y umbrales

- Score 0-100 por par de cuentas.
- Umbrales configurables por tenant:
  - `> 70`: cuenta queda **flageada**, excluida automáticamente de liga/sorteos por ranking.
  - `> 90`: alerta + bloqueo opcional automático de bono welcome de cuentas nuevas en el cluster.
- Revisión manual desde panel "Antifraude": el Admin Tenant ve clusters, decide confirmar/descartar.

## D4. UI panel "Antifraude"

- Listado de clusters de cuentas sospechosas.
- Detalle: usuarios, señales que las vinculan, actividad histórica.
- Acciones: confirmar duplicados (banear N-1), descartar el flag, marcar para watch.

## D5. Roadmap antifraude

| Fase | Detección |
|---|---|
| MVP | Reglas determinísticas (IP, device, datos contacto, mismas wallets cripto). |
| v2 | Heurísticas de comportamiento (timing, patrón de juego). |
| v3 | ML / scoring continuo. Modelo entrenado sobre clusters confirmados. |

---

## E. Auditoría (transversal)

Todo evento relevante en este doc → `audit_log`:
- `bonus.create`, `bonus.edit`, `bonus.cancel`, `bonus.grant_manual`, `bonus.force_clear`
- `promotion.create`, `promotion.edit`, `promotion.cancel`, `promotion.draw`
- `league.create`, `league.close`, `league.manual_adjustment`
- `fraud.cluster_confirm`, `fraud.cluster_dismiss`, `fraud.user_excluded`

Toda otorgación de premio → `wallet_transaction` con `source` claro (`bonus:welcome`, `promo:lottery_tickets:<id>`, `league:weekly:<id>`).

---

## F. Pendientes

- Definir tabla de niveles/XP concreta cuando se implemente cofres (§B8).
- Fórmulas concretas de score combinado para liga (puede salir de configuración inicial con presets).
- Plantillas pre-armadas de bonos/promos para acelerar onboarding de Admins Tenant nuevos.
- Integración con notificaciones (push/email/livechat) — definir en doc separado de notificaciones cuando se cree.
- Modelo de "campañas multi-touch": un usuario impactado por N promos en orden, atribución del último/primer touch al revenue. Probable v2.
