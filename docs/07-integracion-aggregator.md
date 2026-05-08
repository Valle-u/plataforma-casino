# 07 · Integración con Game Aggregator

> Estado: **decidido en estructura**. Detalles concretos del adapter dependen del proveedor que se contrate.

Define cómo enchufamos proveedores de juegos (Pragmatic, Evolution, SoftSwiss, etc.) sin acoplarnos a ninguno. Permite cambiar/sumar proveedores con costo mínimo, y deja la puerta abierta a que en el futuro hagamos juegos propios usando el mismo contrato.

---

## 1. Principios

1. **Adapter Pattern**. Cada proveedor implementa la interfaz `IGameProvider`. El core no sabe (ni le importa) quién está del otro lado.
2. **Seamless wallet** (decidido). El saldo vive en nuestra DB. Cada bet/win llega vía wallet API que nosotros exponemos al proveedor.
3. **Fichas siempre**. El proveedor opera en fichas. La conversión a ARS/USDT vive solo en nuestro sistema (carga/retiro). Ver `docs/01-glosario.md`.
4. **MockGameProvider** desde día uno → desarrollo y testing E2E sin proveedor real.
5. **Reconciliación obligatoria** contra los reportes del proveedor.

---

## 2. Modelo seamless (resumen)

```
Jugador ─→ Lobby (apps/web) ─→ Lanzamiento de juego
                                       │
                                       ▼
                              [Iframe del proveedor]
                                       │
                                       ▼
                              Provider RGS (servidor del juego)
                                       │
                                       │  bet/win/rollback
                                       ▼
                              Wallet API que NOSOTROS exponemos
                              (apps/api/provider-wallet)
                                       │
                                       ▼
                              Wallet interno (Postgres TX)
                                       │
                                       ▼
                              wallet_transactions + audit_log
```

Cada apuesta y cada ganancia genera **una o más filas** en `wallet_transactions` ligadas a `game_round_id`. Cero pérdida de granularidad.

---

## 3. Contrato `IGameProvider`

Interfaz que cada adapter implementa (`packages/adapters/game-providers/`).

```ts
interface IGameProvider {
  readonly code: string;              // 'pragmatic', 'evolution', 'mock'
  readonly name: string;

  // Catálogo
  listGames(filters?: GameFilters): Promise<Game[]>;
  getGame(externalId: string): Promise<Game | null>;

  // Lanzamiento
  launchGame(input: {
    user: TenantUser;
    game: Game;
    locale: string;            // 'es-AR', 'en', 'pt-BR'
    mode: 'real' | 'demo';
    returnUrl?: string;
    deviceType: 'desktop' | 'mobile';
  }): Promise<{ launchUrl: string; sessionToken: string }>;

  // Histórico / replays
  getRoundHistory(input: {
    userId: string;
    from: Date;
    to: Date;
  }): Promise<GameRound[]>;
  getReplay(roundId: string): Promise<{ replayUrl: string } | null>;

  // Jackpots / torneos del proveedor
  getNetworkJackpots(): Promise<NetworkJackpot[]>;
  getProviderTournaments?(): Promise<ProviderTournament[]>;

  // Verificación de salud
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; details?: string }>;
}
```

> Todos los métodos retornan `Promise`. Errores tipados (`ProviderError` con `code`, `retryable`, `cause`).

---

## 4. Wallet API que **nosotros** exponemos al proveedor

Endpoints HTTP que el RGS del proveedor consume durante el juego. Viven en `apps/api/provider-wallet`.

| Método | Endpoint | Función |
|---|---|---|
| POST | `/provider-wallet/balance` | Devolver saldo actual del jugador |
| POST | `/provider-wallet/bet` | Debitar apuesta |
| POST | `/provider-wallet/win` | Acreditar ganancia |
| POST | `/provider-wallet/rollback` | Revertir una operación previa |

### Seguridad
- **HMAC-SHA256** en cada request: `X-Signature: hex(hmac(secret, body))`. Secret por proveedor + por tenant.
- **IP whitelist** del proveedor por tenant.
- **Nonce + timestamp** anti-replay (`X-Nonce`, `X-Timestamp`; rechazar si > 30s de skew).
- **`session_token`** validado en cada llamada — vincula la request a un launch específico.

### Idempotencia
Cada llamada incluye `transaction_id` único del proveedor. Si llega dos veces → respondemos lo mismo, no duplicamos. Almacenado en `idempotency_keys` con scope `provider:<code>`.

### Latencia
Objetivo p99 < 150 ms. Si un proveedor exige menos, optimizar (caché de saldo en Redis con invalidación por TX, evitar joins, etc.).

---

## 5. Flujo de lanzamiento de juego

```
1. Usuario click sobre un juego en el lobby
2. Frontend llama POST /games/launch { game_id, mode }
3. Backend:
   a. Valida que el usuario tenga acceso (status, KYC si aplica)
   b. Si modo 'real': valida saldo > 0
   c. Llama IGameProvider.launchGame() del adapter correspondiente
   d. Recibe launchUrl + sessionToken
   e. Guarda session en game_sessions
4. Frontend abre iframe con launchUrl
5. Provider RGS toma el control del juego
6. Mientras dura la sesión: bet/win/rollback van por wallet API
7. Al cerrar: el provider notifica fin (algunos lo hacen, otros se cierra por timeout)
```

---

## 6. Lobby

### Estructura

```
[Home]
 ├── Hero / banners (configurable por tenant)
 ├── Sección "Destacados" (curado por admin tenant)
 ├── Sección "Más jugados" (auto, por aggregate de game_sessions últimos 7 días)
 ├── Sección "Recién agregados" (últimos 30 días)
 ├── Sección "Jackpots calientes" (juegos con jackpot de red activo)
 └── CTA "Ver todo el catálogo"

[Slots]
 ├── Sub-secciones por proveedor (cards horizontales scrollables)
 ├── Filtros: RTP, volatility, has_jackpot, has_demo, megaways
 └── Búsqueda

[Casino en Vivo]
 ├── Sub-secciones por proveedor
 ├── Tipos: Ruleta, Blackjack, Baccarat, Game Shows
 └── Estado de mesa en tiempo real (jugadores actuales) cuando el provider lo expone

[Deportes]   (cuando se contrate un sportsbook; fuera de MVP de casino)
 └── Placeholder en MVP
```

### Curado
- El **Admin Tenant** decide qué juegos aparecen y en qué orden via `games.is_active`, `games.sort_order`, `games.featured`.
- Tags personalizables por tenant para armar secciones propias ("Favoritos del finde", etc.).

### Performance
- Listado del lobby cacheado en Redis (TTL 5 min, invalidación al toggle de juego).
- Imágenes servidas vía CDN.

---

## 7. Categorías y agrupación

Confirmado:
- **Home** muestra destacados + más jugados (mezcla de proveedores).
- Dentro de cada categoría (Slots, Vivo, Deportes), los juegos **se agrupan por proveedor**. El usuario ve "Pragmatic Play (124)", "Evolution (43)", etc., con scroll horizontal de cards.

---

## 8. Modo demo / fun

- Soportado en MVP cuando el proveedor lo expone (la mayoría sí).
- Modo demo **no** genera `wallet_transactions` ni rounds en nuestra DB (o los marca con flag `is_demo`).
- Sesión de demo vive aparte (`game_sessions.mode = 'demo'`).
- Configurable por tenant: deshabilitable globalmente o por categoría.

---

## 9. Idiomas y monedas

- **Locale del usuario** se pasa al proveedor en cada launch (`es-AR` default).
- **Moneda**: el proveedor siempre ve "fichas" (configurado en su panel como currency virtual). Internamente cada ficha tiene su tasa de conversión configurada en `tenant_settings.chip_to_fiat_rate`.
- Conversión fichas ↔ ARS/USDT ocurre **solo** en flujos de carga/retiro (ver `docs/06-flujos-pagos.md`).

---

## 10. Round history y replays

- Cada round queda en `game_rounds` con `provider_payload` (el JSON que mande el proveedor).
- El **jugador ve su historial** de rounds desde su panel (últimos 90 días por default, configurable).
- Si el proveedor expone replay (la mayoría sí en slots/live): mostramos botón "Ver replay" que abre el `replayUrl` en modal.
- Útil para soporte: ante un reclamo, recuperás el round exacto.

---

## 11. Jackpots

### 11.1 Jackpots de red (del proveedor)
- Worker BullMQ pollea `IGameProvider.getNetworkJackpots()` cada N segundos.
- Resultado se guarda en Redis (cache caliente).
- Lobby los muestra: badge "Jackpot $50.000.000" sobre los juegos elegibles.
- **Costo cero para el tenant**: el pozo lo paga el proveedor desde su pool global.

### 11.2 Jackpots propios del tenant
Decidido: incluidos en MVP.

```sql
tenant_jackpots
  id, name, type enum('fixed','progressive'),
  pool_chips numeric(20,2)        -- pozo actual
  contribution_pct numeric(5,4)   -- % de cada apuesta elegible
  trigger_rule jsonb              -- {random_chance, threshold, schedule}
  eligible_games uuid[]           -- IDs de games elegibles
  status enum('active','paused','won','closed')
  last_won_at timestamptz nullable
  last_winner_user_id uuid nullable
  ...

tenant_jackpot_contributions   -- append-only
  id, jackpot_id, game_round_id, user_id, amount, created_at
```

Flujo:
1. Cada `bet` sobre un juego elegible suma `bet_amount * contribution_pct` al pozo.
2. Trigger configurable:
   - **Random chance** por bet (probabilidad creciente con el pozo).
   - **Threshold**: cuando el pozo > X, el siguiente bet de monto >= Y lo gana.
   - **Schedule**: "el viernes a las 21:00, el último bet activo gana".
3. Al disparar:
   - Se crea `wallet_transaction` tipo `jackpot_win` al ganador.
   - Se notifica con celebración en UI (broadcast vía Socket.io).
   - Se cierra el jackpot, opcionalmente se reabre con seed inicial.
4. Auditoría completa: contribuciones, trigger, ganador.

### 11.3 Visibilidad
Lobby muestra ambos tipos (de red + propios) con badge distinguible. El admin tenant controla cuáles están activos.

---

## 12. Torneos del proveedor

- Si el proveedor los pushea (`getProviderTournaments`), se muestran en una sección "Torneos activos" del lobby.
- Display puro: el ranking, premios y reglas las administra el proveedor.
- Para torneos **propios** del tenant, ver `docs/15-engagement-promos.md` (sección de actividades).

---

## 13. MockGameProvider (dev) — con mini-Crash funcional

Vive en `packages/adapters/game-providers/mock/`. Cumple `IGameProvider` completo.

**Decisión estratégica MVP (locked)**: el mock no es solo un placeholder, **incluye un mini-Crash con math real + provably fair**. Razones:
- Sirve de aprendizaje práctico de math models, RNG, RGS y provably fair durante MVP.
- Cuando llegue v1 (Crash propio "real"), no se empieza de cero — se extiende el mini-Crash existente.
- Tarda 1-2 semanas adicionales en MVP, ahorra ~1 mes en v1.

Capacidades:
- **Catálogo simulado**:
  - 5-10 "slots" con RNG simple (resultados al azar sin math, solo para flujo end-to-end).
  - 2-3 "live" placeholders visuales.
  - **1 mini-Crash con math + provably fair real** (RTP 99% target, simulado y validado).
- **RGS skeleton** en `apps/rgs` sirviendo el mini-Crash. Slots y live mock viven en backend principal porque no aportan al aprendizaje.
- **Provably fair** (commit-reveal con hash chain) implementado completo en el mini-Crash.
- RNG configurable por env var (`MOCK_RTP=0.99`) para tests determinísticos.
- Implementa launchGame retornando URLs del propio frontend:
  - `/games/mock-slot` para slots simples.
  - `/games/mock-crash` para el mini-Crash.
- Permite testear:
  - Flujo wallet completo (bet → win → rollback).
  - UI del lobby con datos.
  - Reconciliación.
  - Casos de error (saldo insuficiente, doble bet, etc.).
  - **Provably fair end-to-end**: jugador puede verificar matemáticamente cada round del mini-Crash.

**Producción nunca tiene los slots mock activos.** Flag `ENABLE_MOCK_SLOTS` solo en dev/staging. **El mini-Crash sí puede quedar activo en producción** si se considera ready (es la versión inicial del Crash propio).

---

## 14. Reconciliación contra el proveedor

Job nocturno por tenant + proveedor:
1. Pedir al proveedor reporte de actividad del día (bets totales, wins totales por juego/usuario).
2. Comparar contra `wallet_transactions` filtradas por `source = 'provider:<code>'`.
3. Si hay discrepancia > umbral configurable:
   - Entrada en `provider_reconciliation_reports`.
   - Alerta a admin tenant + super-admin.
   - Bloqueo opcional automático del proveedor hasta resolver.

---

## 15. Configuración por tenant

`tenant_provider_configs` (DB de tenant):
```
provider_code, is_active,
credentials jsonb (encriptado),
options jsonb,
bet_limits_min, bet_limits_max,
allowed_categories text[],
hidden_games uuid[],
custom_rtp_override jsonb nullable,    -- algunos providers lo permiten
auto_reconcile bool,
reconcile_threshold_pct numeric
```

UI en panel: pantalla "Proveedores" con toggle global, gestión de credenciales, y listado de juegos del proveedor con switch individual.

---

## 16. Errores y manejo

| Error del provider | Acción nuestra |
|---|---|
| Timeout | Marcar round como `pending_reconcile`, retry exponencial |
| HMAC inválido | 401, alertar (intento de fraude) |
| Idempotency conflict | 409, devolver respuesta original |
| Saldo insuficiente en bet | 402 (`INSUFFICIENT_FUNDS`) |
| Sesión expirada | 401, forzar re-launch |
| Provider down | Marcar provider como `degraded`, ocultar del lobby, alertar |

---

## 17. Roadmap del módulo

| Fase | Qué |
|---|---|
| MVP | Mock provider + 1 provider real (a contratar). Lobby básico. Seamless wallet completa. Jackpots de red + propios. Modo demo. Round history. |
| v2 | 2-3 providers más. Torneos del provider integrados al panel. Live stats avanzadas. Reconciliación más rica. |
| v3 | Juegos propios cumpliendo `IGameProvider`. Posibilidad de exponer nuestro propio aggregator a otros operadores. |

---

## 18. Pendientes / a definir

- Proveedor concreto a contratar primero (afecta detalles de credenciales y certificación).
- Política frente a juegos con RTP variable (algunos providers permiten 3-4 versiones del mismo juego con RTPs distintos — definir cuál exponemos).
- Estrategia de fees del proveedor: ¿se descuentan del netwin del tenant antes de calcular nuestra comisión, o después? **Recomendación: antes** (comisión sobre netwin neto post-fees del provider).
- Soporte multi-currency simultáneo en juegos (algunos providers lo permiten — fuera de MVP).
- Sistema de límites responsables (responsible gaming): self-exclusion, límites de depósito/apuesta. Importante de implementar aunque no estemos regulados (ética + futuro compliance). Ver `docs/12-seguridad-compliance.md`.
