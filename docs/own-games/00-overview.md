# Juegos Propios · 00 · Overview

> Estado: **decidido en estructura**. Cada juego tendrá su propio sub-documento cuando se diseñe.
>
> **Doc relacionado**: la decisión específica de qué game engine usar por tipo de juego vive en [`01-stack-decision.md`](./01-stack-decision.md) — incluye research de la industria, comparación de engines y costos realistas por juego.

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

Plan recomendado, ajustable según ritmo. Timeline calibrado con investigación de costos reales de la industria — ver [`01-stack-decision.md §6`](./01-stack-decision.md#6-costo-realista-por-juego-research-backed).

### Filosofía del orden

**Crash games primero, slots al final.** Razones:

1. **Crash games son baratos de hacer**: 6-8 semanas el primero, 2-3 semanas cada reskin posterior. Compartimen 80% del código.
2. **Slots premium son carísimos**: un slot tipo Joker's Jewels son **4-6 meses part-time**, sin features. Con features (cascade, multipliers, free spins) son 8-12 meses.
3. **Crash games tienen retención brutal**: el formato Aviator es uno de los más rentables de la industria moderna.
4. **Aprovechamos infra**: math + RGS + provably fair shared entre todos los crash games.

### Plan realista — 12 meses post-MVP

| Mes | Juego | Tiempo | Engine |
|---|---|---|---|
| **MVP** (mes 5-6) | **Mini-Crash dentro del MockGameProvider** | +1-2 semanas en MVP | n/a (parte del mock) |
| **Mes 7-8** | Infra compartida: `apps/rgs` + `packages/games-shared` + provably fair + math simulator | 2 meses | TypeScript / Node |
| **Mes 9-10** | **Crash #1** (avión clásico tipo Aviator) | 6-8 semanas | **Phaser 3** + Socket.IO |
| **Mes 11-12** | **Crash #2-5** (reskins: globo, gallinita, nave, cohete) | 2-3 semanas c/u | Phaser 3 (mismo motor) |

**Total al cierre del año post-MVP**: 5 crash games funcionando + infra completa.

### Plan año 2

| Mes | Juego | Tiempo | Engine |
|---|---|---|---|
| **Mes 13-14** | **Mines** | 4-6 semanas | Canvas 2D / PixiJS minimal |
| **Mes 15-16** | **Plinko** | 4-6 semanas | Canvas 2D + física simple |
| **Mes 17** | **Dice** | 2-3 semanas | Canvas 2D |
| **Mes 18-22** | **Slot #1** tipo Joker's Jewels (5×3, sin features) | 4-6 meses | **PixiJS + Spine + GSAP** |
| **Mes 23-24** | Pulido + arranque slot #2 | — | PixiJS |

**Total al cierre del año 2**: 5 crash + 3 mini-games + 1 slot = **9 juegos propios funcionando**.

### Año 3+

- Slot #2 y #3 — reutilizando infra de PixiJS + Spine del primero. Más rápidos cada uno (3-4 meses).
- Ruleta europea propia (math conocido, 2-3 meses).
- Blackjack propio (3-4 meses con strategy table).
- Live casino — equipo presencial, fuera de scope solo dev.

### Lo que NO es realista

Esto se documenta acá para evitar promesas mentirosas:

- **10 juegos en 6 meses con calidad Pragmatic**: no. Pragmatic dedica equipos de 5-8 personas × 4-6 meses por slot. Vos solo part-time tenés ~1 person-month/mes.
- **Clonar Sweet Bonanza o Gates of Olympus visualmente al detalle**: requiere artist Spine + sound designer + 8-12 meses por slot. Lejos del alcance solo dev.
- **Operar en mercado regulado sin auditoría**: necesitás eCOGRA/GLI ($5k-50k por juego). Provably fair suple esto en mercado informal pero NO regulado.

### Alternativa pragmática para "tener 10 juegos rápido"

Si el objetivo de negocio es **tener catálogo amplio desde día 1 al primer cliente externo**, lo realista es:

- Licenciar provider externo **tier-2** (Hacksaw, BGaming, Spinomenal, Booongo) → te da 100+ juegos prefabricados.
- Diferenciás con **2-3 juegos propios cuidadosamente hechos** (un crash + un mines + un slot simple).
- Te despegás de Pragmatic-tier que NO licencia a operadores no regulados.

Esto está reflejado en `docs/14-roadmap.md §11`.

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
│  Game Client (Phaser 3 / PixiJS según juego — ver §7)       │
│  Sirve estático desde apps/games/<slug>                     │
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
- **`apps/games/<slug>/`** — cliente del juego (HTML+JS, build estático via Vite). Engine según tipo de juego (ver §7). Assets pesados (sprites grandes, audio, Spine binaries) viven en R2/CDN, no en git.
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

## 7. Game engines — Phaser 3 + PixiJS (decisión dual)

> Cambio respecto a la versión original del doc: este § elegía Phaser 3 como engine único.
> Sprint 54 (post-investigación de stack industria) lo cambiamos a un enfoque dual.
> Justificación completa en [`01-stack-decision.md`](./01-stack-decision.md).

### Decisión

Cada tipo de juego usa el engine que mejor se ajusta a su naturaleza:

| Tipo de juego | Engine | Por qué |
|---|---|---|
| **Crash games** (Aviator, globo, gallinita, etc.) | **Phaser 3** | Phaser brilla cuando hay game loop + scenes + tween engine. Un crash game es exactamente eso: "una pantalla con un personaje que sube y a veces explota". Ahorra ~2 semanas de boilerplate vs PixiJS puro. |
| **Slots premium** (5×3, 5×5 cascade, etc.) | **PixiJS** + **Spine 2D** + **GSAP** | Es lo que usa la industria (Pragmatic Play, Hacksaw, Push Gaming). Renderer puro + animaciones esqueléticas + tween fino. Mejor performance al renderizar muchos sprites animados simultáneos. |
| **Juegos minimalistas** (Mines, Plinko, Dice) | **Canvas 2D** o PixiJS minimal | Stake Originals son básicamente React + Canvas. Engine pesado sería over-engineering. Bundle ~50KB vs ~500KB. |

### Stack compartido entre todos los engines

| Componente | Decisión |
|---|---|
| Audio | **Howler.js** |
| Real-time multiplayer (crash) | **Socket.IO** cliente + `ws` server |
| Build | **Vite** |
| Lenguaje | **TypeScript** estricto |
| Math execution | **Server-side (RGS)** — el cliente solo dibuja outcomes |

### Alternativas evaluadas (y descartadas)

| Engine | Pro | Con — por qué NO |
|---|---|---|
| **Phaser 3 para slots** | Maduro, fácil | Industria no lo usa para slots premium. Pragmatic-tier va con PixiJS. |
| **Three.js** | 3D potente | Overkill para 2D web. Slots y crash son 2D. |
| **Cocos Creator** | Editor visual | Workflow no-TypeScript-puro. Más usado en Asia. |
| **Construct 3** | No-code | Limitado para math compleja, vendor lock-in, royalties. |
| **Unity / Godot** | Engines pro | Exporta a WebGL pero el bundle pesa 5-10MB+. Bypass del browser-first. |

### Workflow (igual para los dos engines)

- Cada juego es un proyecto independiente en `apps/games/<slug>/` (cliente) y `apps/rgs/games/<slug>/` (servidor de math).
- Build con Vite → bundle estático servido desde CDN.
- Code-splitting + lazy assets.
- Assets pesados (sprites, sonidos, animaciones Spine) NO van en git — viven en R2/CDN, se referencian por URL.

---

## 8. Estructura de un juego

### 8.1 Ejemplo: Crash (Phaser 3)

```
apps/games/crash/                   ← cliente del juego (build estático)
├── public/
│   ├── sprites/                    (assets visuales — referenciados, no commiteados pesados)
│   ├── audio/
│   └── index.html
├── src/
│   ├── main.ts                     (entry, Phaser config)
│   ├── scenes/
│   │   ├── boot.ts
│   │   ├── lobby.ts
│   │   └── round.ts
│   ├── game-client/                (cliente que habla con RGS)
│   │   ├── rgs-socket.ts
│   │   ├── provably-fair-ui.ts
│   │   └── balance-display.ts
│   └── ui/
└── package.json

apps/rgs/games/crash/                ← servidor de math (lógica autoritaria)
├── math.ts                          (RTP target, distribución, fórmulas)
├── simulator.ts                     (Monte Carlo)
├── server.ts                        (handlers de WebSocket)
├── round-engine.ts                  (orquesta cada round)
└── tests/
    ├── math.spec.ts                 (RTP convergence test)
    └── round.spec.ts

docs/own-games/crash/                ← documentación del juego
├── 00-overview.md
├── math.md                          (paytable, distribución, simulaciones)
└── ux.md                            (decisiones visuales)
```

### 8.2 Ejemplo: Slot tipo Joker's Jewels (PixiJS + Spine)

Cambia el cliente — el RGS y los docs son estructura idéntica.

```
apps/games/jokers-jewels/
├── public/
│   ├── sprites/                    (símbolos del slot)
│   ├── spine/                      (animaciones esqueléticas .json + .atlas + .png)
│   ├── audio/                      (música, spin sound, win sounds)
│   └── index.html
├── src/
│   ├── main.ts                     (entry, PixiJS Application setup)
│   ├── reels/
│   │   ├── reel.ts                 (un reel individual)
│   │   ├── reel-strip.ts           (la cinta de símbolos)
│   │   └── spin-controller.ts      (orquesta los 5 reels)
│   ├── animations/
│   │   ├── win-lines.ts            (animación de líneas ganadoras)
│   │   ├── bonus-reveal.ts         (transición a free spins)
│   │   └── symbol-anims.ts         (Spine wrappers)
│   ├── ui/                         (paytable, balance, bet selector)
│   ├── game-client/                (idem crash — comparte interfaz con RGS)
│   └── audio/                      (Howler.js setup, sound bus)
└── package.json

apps/rgs/games/jokers-jewels/
├── math.ts                          (paytable, win calculator, RTP target 96%)
├── simulator.ts                     (Monte Carlo 10M rounds)
├── server.ts                        (handlers HTTP — slots no necesitan WS)
├── round-engine.ts                  (decide el outcome de un spin)
└── tests/
    └── math.spec.ts

docs/own-games/jokers-jewels/
├── 00-overview.md
├── math.md
├── client-arch.md                   (estructura PixiJS, scenes, asset budget)
└── ux.md
```

### 8.3 Ejemplo: Mines (Canvas 2D minimal)

Sin engine pesado — UI puede ser React directamente en el iframe.

```
apps/games/mines/
├── public/
│   └── index.html
├── src/
│   ├── main.tsx                     (entry, React root)
│   ├── components/
│   │   ├── Grid.tsx                 (grilla 5×5 de celdas)
│   │   ├── Cell.tsx                 (celda individual — Canvas para la animación de reveal)
│   │   ├── BetControls.tsx
│   │   └── MultiplierDisplay.tsx
│   ├── game-client/                 (idem)
│   └── audio/                       (Howler.js — explosión, win, reveal)
└── package.json

apps/rgs/games/mines/                 ← idéntica estructura
docs/own-games/mines/                 ← idéntica estructura
```

> **Patrón**: el RGS y los docs son uniformes entre juegos. Lo único que cambia entre juegos es la implementación del cliente, que depende del engine elegido (Phaser / PixiJS / Canvas+React).

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
