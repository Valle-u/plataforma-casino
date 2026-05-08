# Juegos Propios · 00 · Overview

> Estado: **decidido en estructura**. Cada juego tendrá su propio sub-documento cuando se diseñe.

Define cómo construimos juegos propios de casino que se enchufan a la plataforma vía el mismo contrato `IGameProvider` ya documentado (`docs/07-integracion-aggregator.md`). Permite a futuro reemplazar / complementar providers externos con catálogo propio.

---

## 1. Por qué juegos propios

| Razón | Implicación |
|---|---|
| **Independencia de providers** | Tier 1 (Pragmatic, Evolution) no integran con operadores no licenciados. Tier 2 tienen calidad cuestionable. Hacerlos propios destraba esa restricción. |
| **100% del revenue del juego** | Sin comisión a provider (típicamente 15–25%). Toda la pérdida del jugador queda en el casino. |
| **Diferenciación al vender la plataforma** | "Plataforma con catálogo de juegos propios" vale mucho más que "plataforma que integra terceros". |
| **Branding completo** | Skin, lore, personajes a medida del tenant si se quiere. |
| **Aprendizaje técnico** | Math, RNG, RGS, provably fair son skills caros. Construirlos = activo de conocimiento. |

### Trade-offs reales
- **Mucho trabajo**: 2-6 meses por juego siendo realista part-time.
- **Sin certificación oficial** (eCOGRA, GLI, BMM): no operás en mercados regulados sin pagar miles de USD por juego.
- **Confianza inicial baja**: jugadores no confían en juegos nuevos. Mitigamos con **provably fair** + RTP transparente públicamente.
- **Catálogo limitado al inicio**: 1 juego propio vs 200 del provider externo.

---

## 2. Principios

| Principio | Implicación |
|---|---|
| **El servidor decide, el cliente solo dibuja** | RNG corre en el servidor (RGS). Cliente recibe el resultado y lo anima. Imposible cheatear desde el navegador. |
| **Provably fair desde día 1** | Cada round verificable matemáticamente por el jugador. No por convención: por hash chain + seed reveal. |
| **Math antes que arte** | Diseñar el juego empieza por la matemática. RTP, volatilidad, distribución de premios. El arte se suma después. |
| **Mismo contrato que providers externos** | Cada juego propio cumple `IGameProvider` (ver `docs/07-integracion-aggregator.md §3`). Se enchufa al lobby como "uno más". |
| **Cero diferencia para el jugador entre juego propio y externo** | Misma UX, mismo wallet, mismo livechat. El jugador no necesita saber quién hizo el juego. |
| **Auditable y reproducible** | Cualquier round del pasado se puede recrear desde el seed. Crítico para soporte y disputas. |
| **TypeScript end-to-end** | Math, RGS, cliente. Todo TS. Mismos tipos compartidos con la plataforma. |

---

## 3. Roadmap de juegos propios

Plan recomendado, ajustable según ritmo:

| Fase | Juego | Tiempo estimado | Por qué |
|---|---|---|---|
| **MVP** (mes 5–6) | **Mini-Crash dentro del MockGameProvider** | +1–2 semanas en MVP | **Decisión locked**: aprovechar MVP para aprender math + RNG + RGS + provably fair sobre un crash básico. Cuando llegue v1, no se empieza de cero — se extiende. Ver `docs/07-integracion-aggregator.md §13`. |
| **MVP+** (mes 7–10) | **Crash game completo** (extendido del mini-Crash, tipo Aviator) | 1.5–2 meses (en lugar de 3) | El mini-Crash del MVP ya cubre math, provably fair y RGS. Acá se agregan: UI Phaser pulida, multi-bet, auto-cashout, leaderboards, multiplayer real-time, polish total. |
| **v1** (mes 11–14) | **Mines** o **Plinko** | 1–2 meses cada uno | Mecánicas simples, provably fair fácil, popular en cripto-casinos. |
| **v1.5** (mes 14–18) | **Slot 3-reel clásico** | 2–4 meses | Aprender la mecánica de slots con math conocido. |
| **v2** (mes 18–24) | **Slot video (5 reels + bonus)** | 4–6 meses | Producto comercial de verdad. |
| **v2+** | **Ruleta**, **Blackjack**, otros slots | 3+ meses cada uno | Catálogo expandido. |
| **v3+** | **Live casino** | Equipo | Fuera de scope solo. |

> Mientras se construyen los propios, el **MockGameProvider** del MVP sigue activo para flujos generales y testing. Cuando un juego propio está listo, se enchufa al lobby como provider más, en paralelo al mock o al provider externo si se contrata uno.

---

## 4. Arquitectura general

```
┌─────────────────────────────────────────────────────────────┐
│  apps/web (jugador)                                         │
│  Lobby → click en juego propio → iframe a /games/<slug>     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Game Client (Phaser 3 + TS)                                │
│  Sirve estático desde apps/web/games/<slug>                 │
│  - Renderiza UI/animaciones                                 │
│  - NO contiene lógica de RNG                                │
│  - Habla con el RGS por WebSocket / HTTP                    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  RGS (Remote Game Server) — apps/rgs                        │
│  Servicio Node.js separado (TS)                             │
│  - Recibe "place bet"                                       │
│  - Llama wallet API de la plataforma para debitar           │
│  - Ejecuta math + RNG (provably fair)                       │
│  - Llama wallet API para acreditar win                      │
│  - Devuelve resultado al cliente                            │
│  - Persiste round                                           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Plataforma core (apps/api)                                 │
│  Provider Wallet API (HMAC, idempotencia, scope)            │
│  Mismo flujo que con providers externos                     │
└─────────────────────────────────────────────────────────────┘
```

### Servicios involucrados

- **`apps/rgs`** — nuevo servicio Node.js que aloja la lógica de juego.
- **`apps/web/games/<slug>/`** — assets estáticos del cliente del juego (HTML+JS+sprites+sonidos).
- **`packages/games-shared/`** — tipos y utilidades compartidos entre RGS y clientes (math primitives, provably fair helpers).
- **`packages/adapters/game-providers/own/`** — adapter `OwnGamesProvider` que cumple `IGameProvider` y rutea a nuestro RGS interno.

### Por qué RGS separado del backend principal

- **Latencia crítica**: bet/win necesita p99 < 150ms. Servicio dedicado optimizable.
- **Escalabilidad independiente**: si un juego pega volumen, escalo solo el RGS.
- **Aislamiento de fallas**: bug en math de juego no rompe la plataforma entera.
- **Redeploys sin downtime de la plataforma**: actualizo math de juego sin tocar API principal.

---

## 5. Provably Fair

Mecanismo que permite a cualquier jugador **verificar matemáticamente** que un round no fue manipulado.

### Patrón usado: commit-reveal con hash chain

```
Antes de empezar a jugar:
  1. Servidor genera una seed_servidor secreta (32 bytes random).
  2. Servidor calcula hash_servidor = SHA256(seed_servidor).
  3. Servidor publica hash_servidor al cliente. Esto es el "commit".
  4. Cliente provee su propia seed_cliente (puede ser custom o auto-generada).
  5. Cliente y servidor combinan: seed_round = SHA256(seed_servidor + seed_cliente + nonce).
  6. seed_round se usa para todo el RNG del round.
  
Después del round:
  7. Servidor revela seed_servidor.
  8. Cliente puede verificar:
     a. SHA256(seed_servidor) == hash_servidor publicado antes? (si no, hizo trampa)
     b. SHA256(seed_servidor + seed_cliente + nonce) == seed_round usada?
     c. ¿La math aplicada a seed_round produjo realmente este resultado?
```

### Implementación

```ts
// packages/games-shared/provably-fair.ts
import { createHash, randomBytes } from 'crypto';

export function newServerSeed(): { seed: Buffer; hash: string } {
  const seed = randomBytes(32);
  const hash = createHash('sha256').update(seed).digest('hex');
  return { seed, hash };
}

export function computeRoundSeed(
  serverSeed: Buffer,
  clientSeed: string,
  nonce: number,
): Buffer {
  return createHash('sha256')
    .update(serverSeed)
    .update(clientSeed)
    .update(nonce.toString())
    .digest();
}

export function rngFromSeed(seed: Buffer): () => number {
  // Generador determinístico [0, 1) a partir del seed.
  // Cada llamada consume bytes del seed. Ver implementación específica por juego.
}
```

### UI del jugador

En cada juego propio:
- Botón "Verificar fairness" muestra:
  - `hash_servidor` antes del round.
  - `seed_servidor` después del round.
  - `seed_cliente` (editable antes del round).
  - `nonce` (incrementa cada bet).
  - Link a "Cómo verificar matemáticamente" → tutorial + tool externo opensource.
- Histórico de rounds verificables.

### Rotación de server seed

- Cada server seed se usa por hasta N rounds (configurable, ej. 1000).
- Después se rota: revela el viejo, commit del nuevo.
- Jugador puede forzar rotación cuando quiera ("Cambiar mi seed").

---

## 6. Math models

El alma del juego. Define cuánto pierde el jugador en el largo plazo (y por ende, cuánto gana el casino).

### Conceptos clave

| Concepto | Significado |
|---|---|
| **RTP (Return to Player)** | % del total apostado que vuelve a jugadores en el largo plazo. Ej: RTP 96% = casino se queda con 4% (house edge). |
| **House edge** | 100% − RTP. La ventaja del casino. |
| **Volatility** | Cómo se distribuyen los premios. Alta vol = pocos premios grandes. Baja vol = muchos premios chicos. |
| **Hit frequency** | % de rounds que devuelven cualquier premio (incluso ≤ 1x). |
| **Max win** | Máximo multiplicador alcanzable. Define el "techo" de emoción. |

### RTP típicos del rubro

- Slots: 95–97%.
- Crash: 99% (en Aviator es ~99%, super competitivo).
- Mines: configurable, típicamente 97–99%.
- Plinko: 97–99%.
- Ruleta europea: 97.3% (matemáticamente fija).
- Blackjack con estrategia óptima: 99.5% (la skill del jugador influye).

### Diseño de un math

Pasos al crear un juego:

1. **Definir mecánica**: ¿qué hace el jugador?
2. **Modelar matemáticamente**: variables aleatorias, distribuciones, eventos.
3. **Targetear RTP**: típicamente 95-97% para casino comercial.
4. **Decidir volatility**: alta / media / baja según target audience.
5. **Validar con Monte Carlo**: simular 10M+ rounds, medir RTP empírico, verificar que matche el target ±0.1%.
6. **Stress tests**: edge cases, max win frequency, sequences de pérdida.
7. **Iterar** hasta math convergir + sentirse "bien" en pruebas de juego.

### Herramientas

- **Simulador en Node.js** (`packages/games-shared/simulator`): corre N rounds del juego, devuelve estadísticas.
- **Math worksheet por juego**: documento Markdown con probabilidades, paytables, fórmulas, resultados de simulación. Vive en `docs/own-games/<slug>/math.md`.
- **Tests de propiedad**: tests de Jest que corren simulación reducida (1M rounds) y aseguran RTP dentro de tolerancia. Corren en CI.

---

## 7. Game engine — Phaser 3

### Por qué Phaser

- Maduro, comunidad enorme, mucho ejemplo de slots/crash en GitHub.
- TypeScript first-class.
- Performance: WebGL + Canvas fallback.
- Plugins para spine, audio, partículas, tweens.
- Gratis, sin royalties.

### Alternativas evaluadas

| Engine | Pro | Con |
|---|---|---|
| **PixiJS** | Más rápido en rendering puro | No es engine completo, hay que armar más cosa |
| **Cocos Creator** | Editor visual potente | Workflow no-TypeScript-puro |
| **Construct 3** | No-code | Limitado para math compleja, vendor lock-in |
| **Unity / Godot** | Engines pro | Overkill para 2D web, exporta a WebGL pero pesado |

### Workflow

- Cada juego es un proyecto Phaser independiente.
- Se desarrolla en `apps/web/games/<slug>/` o como package separado.
- Build con Vite/esbuild → bundle estático servido desde CDN.
- Carga rápida: code-splitting + lazy assets.

---

## 8. Estructura de un juego (ejemplo: Crash)

```
apps/web/games/crash/
├── public/
│   ├── sprites/         (assets visuales)
│   ├── audio/
│   └── index.html
├── src/
│   ├── main.ts          (entry, Phaser config)
│   ├── scenes/
│   │   ├── boot.ts
│   │   ├── lobby.ts
│   │   └── round.ts
│   ├── game-client/     (cliente que habla con RGS)
│   │   ├── rgs-socket.ts
│   │   ├── provably-fair-ui.ts
│   │   └── balance-display.ts
│   └── ui/
└── package.json

apps/rgs/games/crash/
├── math.ts              (RTP target, distribución, fórmulas)
├── simulator.ts         (Monte Carlo)
├── server.ts            (handlers de WebSocket)
├── round-engine.ts      (orquesta cada round)
└── tests/
    ├── math.spec.ts     (RTP convergence test)
    └── round.spec.ts

docs/own-games/crash/
├── 00-overview.md
├── math.md              (paytable, distribución, simulaciones)
└── ux.md                (decisiones visuales)
```

---

## 9. Assets y producción

### Estrategia mixta

| Tipo de asset | Cómo se obtiene |
|---|---|
| **Sprites de personajes / iconos del juego** | Mix: AI generation (Midjourney, DALL-E) + edición manual. Marketplaces (GameDev Market, itch.io) para complementar. |
| **Backgrounds** | AI generation principalmente. |
| **Animaciones complejas** | Spine 2D si el budget lo permite ($300 license). Alternativa: tweens en Phaser. |
| **Audio (música, SFX)** | Marketplaces ($20-100 paquetes). Alternativa: AI generation (suno.ai, ElevenLabs). |
| **UI / botones** | Sistema de diseño propio coherente con `packages/ui`. |
| **Iconos de premios** | Marketplaces o creados a medida. |

### Tono visual

- Coherente con la paleta base del tenant (`docs/11-personalizacion.md`): negros, grises, blancos, rojo accent.
- Pero el juego puede ser más **expresivo** dentro del iframe. El sitio jugador es sobrio, el juego puede ser celebratorio.

### Costos estimados por juego

- Sprites + UI: $50–500 (mix gratis + paid).
- Audio: $50–200.
- AI generation creditos: $20–100.
- **Total realista**: $100–800 por juego en assets, sin contar tu tiempo.

---

## 10. Wallet API integration

Idéntico al patrón con providers externos (`docs/07-integracion-aggregator.md §4`):

- RGS llama `POST /provider-wallet/balance`, `/bet`, `/win`, `/rollback`.
- HMAC firma + idempotency-key + scope.
- El RGS interno tiene credenciales como cualquier provider (`tenant_provider_configs.code = 'own'`).
- Diferencia: el secret del HMAC es interno, no compartido con third party.

---

## 11. Testing

### Niveles

1. **Math correctness** (CI): tests de simulación 1M rounds, asegurar RTP empírico ±0.1% del target.
2. **RGS unit tests**: lógica de cada handler, edge cases.
3. **Integration tests**: round completo end-to-end (place bet → RGS → wallet → result → wallet) en ambiente de test.
4. **Provably fair tests**: verificar que rounds del pasado son reproducibles desde seeds.
5. **Client tests**: smoke tests con Playwright (carga de juego, UI básica funciona).
6. **Load tests** (pre-launch): k6 sobre RGS, asegurar p99 < 150ms a 100 RPS.

### Tests obligatorios antes de lanzar un juego nuevo

- [ ] Simulación 10M rounds, RTP dentro de tolerancia.
- [ ] Edge cases: max win, min bet, bet en transition de servers seeds.
- [ ] Provably fair: 100 rounds reproducibles a posteriori desde seeds.
- [ ] Wallet API: idempotencia probada (mismo bet 2 veces → no duplica).
- [ ] Concurrencia: 50 jugadores simultáneos sin race condition.
- [ ] Cliente: carga en mobile + desktop, sin errores de consola.
- [ ] Audit log: bet, win, rollback dejan registro correcto.

---

## 12. Compliance y certificación

### Sin licencia (donde estás ahora)

- **Provably fair** suple la falta de auditoría externa para ganar confianza del jugador.
- **RTP publicado** transparente en cada juego.
- **Histórico completo** de rounds disponible al jugador.
- **Tutorial de verificación** público.

### Si en futuro buscás licencia

- Auditorías formales: **eCOGRA**, **GLI**, **BMM Testlabs**, **iTech Labs**.
- Costo: $5.000–$50.000 por juego dependiendo del lab.
- Tiempo: 2-6 meses por certificación.
- Requiere documentación detallada del math, RNG, código auditable.
- **Por eso math y código tienen que estar bien hechos desde el día 1**, aunque no certifiques.

---

## 13. Plan de ejecución del primer juego (Crash)

Cuando llegue MVP+:

### Sprint 1 (4 semanas part-time)
- Diseño de math (paytable, distribución de "crash multiplier").
- Simulador en Node.js, validar RTP target 99%.
- Documentar en `docs/own-games/crash/math.md`.
- RGS skeleton (`apps/rgs`), endpoints básicos.
- Provably fair backend.

### Sprint 2 (4 semanas)
- Cliente Phaser 3 con avión + curva animada.
- WebSocket entre cliente y RGS.
- Botones bet + cashout.
- UI de balance + historial reciente.

### Sprint 3 (2-4 semanas)
- UI de provably fair en cliente.
- Stats (multipliers altos recientes, "tu mejor round").
- Sonidos + animaciones polish.
- Mobile responsive.
- Tests de carga.

### Sprint 4 (2 semanas)
- QA con vos jugando.
- Bug fix.
- Integración en lobby de la plataforma.
- Launch.

**Total: 3–4 meses** para tener Crash en producción.

---

## 14. Permisos a sumar al catálogo de `03-jerarquia-roles.md`

- `own_games.deploy` — push de nueva versión de un juego (Admin Tenant + super-admin).
- `own_games.math_edit` — modificar math (super-admin reservado, peligroso).
- `own_games.view_internals` — ver seeds, simulaciones, datos internos.
- `own_games.replay_round` — recrear round del pasado (soporte).

---

## 15. Documentos por juego (a crear cuando se empiece cada uno)

```
docs/own-games/
├── 00-overview.md           ← este doc
├── 01-rgs-architecture.md   ← cuando se implemente RGS, expandir §4
├── 02-provably-fair.md      ← expansión técnica del §5
├── 03-math-fundamentals.md  ← teoría reutilizable
├── 04-asset-guidelines.md   ← estética coherente entre juegos
└── crash/
    ├── 00-overview.md
    ├── math.md              ← paytable, distribución, simulaciones
    ├── ux.md                ← decisiones de UI/UX
    ├── seeds-rotation.md    ← política específica
    └── deployment.md        ← cómo se despliega
```

Cada juego nuevo abre su carpeta `<slug>/` con sus propios docs.

---

## 16. Pendientes / a definir al implementar

- **Naming/branding** del primer juego propio (¿"Crash X"? ¿algo más distintivo?).
- **Política de jackpots dentro de juegos propios**: ¿permitimos jackpots progresivos? Math más complejo.
- **Multi-bet** (bet en 2 rounds simultáneos en Crash) — popular pero complica el código.
- **Auto-cashout** y **auto-rebet** — features esperables en Crash.
- **Hot reload de math en RGS** sin downtime — feature avanzado, post-launch.
- **Sistema de leaderboards específico** del juego (top wins, top multipliers).
- **Skin / theme variants**: el mismo juego con distintos skins por tenant. Implica abstraer assets de math.
- **Multiplayer real-time** (Crash es naturalmente multiplayer; otros juegos no necesariamente).
- **Anti-bot dentro del juego**: detectar jugadores que usan auto-play scripts (¿permitidos? ¿hasta cuál nivel?).
