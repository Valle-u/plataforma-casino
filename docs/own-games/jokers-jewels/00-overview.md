# Joker's Jewels · Overview

> Estado: **Fase 1 — Math + RGS** en curso (iniciada Sprint 54 / 2026-05-25).
> Primer juego propio de la plataforma.

Clone funcional del slot **Joker's Jewels** de Pragmatic Play. Elegido como primer juego propio por ser el slot más simple del catálogo Pragmatic-tier (sin features: sin free spins, sin cascade, sin bonus rounds), lo cual lo hace el punto de entrada más razonable al stack de slots para un dev solo part-time.

---

## 1. Aviso legal interno

Decisión del dueño 2026-05-25: arrancamos con **copia directa** (nombre + visuales + math) **para uso interno / piloto cerrado**. El riesgo legal mientras esto no esté expuesto comercialmente es ~0.

**Antes de exponer a primer cliente externo / producción real / venta de la plataforma**:

- [ ] Renombrar el juego (sugerencias: "Crown Jester", "Royal Joker", "Diamond Jester")
- [ ] Reskin de los assets — los sprites pixel-perfect de Pragmatic son copyright de Pragmatic. Generar nuevos con AI / stock.
- [ ] Cambiar el logo / título.

El math model y la mecánica son fórmulas matemáticas — **no son protegibles**. Esos se quedan.

Cuando se active ese checkpoint, abrir issue "Rename Joker's Jewels antes de prod".

---

## 2. Mecánica del juego (lo que copiamos)

| Parámetro | Valor |
|---|---|
| Reels | 5 |
| Filas visibles | 3 |
| Paylines | **5** (no 10, no 20, no 243 — solo 5) |
| Pago | Izquierda a derecha, mínimo 3 iguales consecutivos |
| Wild | Joker (sustituye a cualquier símbolo, paga como el más alto) |
| Scatter / bonus | Ninguno (la "corona" es un símbolo regular de alto pago, no scatter) |
| Free spins / bonus rounds | **Ninguno** |
| RTP target | **96.50%** |
| Volatility target | Media (4 sobre 5 en escala Pragmatic) |
| Max win | 1000× bet (cap del juego) |
| Hit frequency | ~30% (medida en simulación, no target) |
| Bet range | Configurable por tenant. Default: 0.10 - 100 chips |

### Las 5 paylines

```
Reel:    1 2 3 4 5

Línea 1: ─ ─ ─ ─ ─   (top)
Línea 2: ═ ═ ═ ═ ═   (middle)
Línea 3: ─ ─ ─ ─ ─   (bottom)
Línea 4: ╲ ╱ ╲ ╱ ╲   (V invertida: top-mid-bot-mid-top)
Línea 5: ╱ ╲ ╱ ╲ ╱   (V normal: bot-mid-top-mid-bot)
```

### Símbolos

8 símbolos en total (incluido el wild):

| Symbol code | Nombre | Tier | Pagos 5/4/3 (× bet por línea) |
|---|---|---|---|
| `joker` | Joker (wild) | T1 | 200 / 40 / 4 |
| `crown` | Corona | T2 | 50 / 10 / 2 |
| `mandolin` | Mandolina | T3 | 40 / 8 / 2 |
| `boots` | Botas rosadas | T3 | 40 / 8 / 2 |
| `diamond_pink` | Diamante rosado | T4 | 8 / 2 / 0.4 |
| `ruby` | Rubí (rojo) | T4 | 8 / 2 / 0.4 |
| `sapphire` | Zafiro (azul) | T4 | 8 / 2 / 0.4 |
| `emerald` | Esmeralda (verde) | T4 | 8 / 2 / 0.4 |

> Las 4 gemas pagan igual entre sí — son intercambiables matemáticamente. Visualmente distintas para variedad estética.

> Los pagos están en **multiplicador del bet por línea**. Si el jugador apuesta 1 chip total (0.2 por línea × 5 líneas), un 5 de joker paga 200 × 0.2 = 40 chips netos.

Ver paytable + reel strips completas en [`math.md`](./math.md).

---

## 3. Wild behavior

Joker es el único wild:

- Sustituye a cualquier símbolo para completar una línea ganadora.
- **No paga por su cuenta** salvo si forma su propia combinación (5 jokers = 200×, 4 jokers = 40×, etc.).
- Si una línea tiene 5 jokers, paga el premio del joker (200×) que es el más alto del juego.

---

## 4. Provably fair

Estándar del proyecto (ver [`../00-overview.md §5`](../00-overview.md#5-provably-fair)):

1. Server genera `server_seed` (32 bytes random).
2. Server publica `SHA256(server_seed)` al cliente.
3. Cliente provee `client_seed` (custom o auto).
4. Para cada spin: `round_seed = SHA256(server_seed + client_seed + nonce)`.
5. `round_seed` alimenta el RNG determinístico que decide los símbolos de los 5 reels.
6. Después del round, server revela `server_seed` para que el jugador pueda recrear el resultado.

Rotación de `server_seed`: cada **1000 spins** por defecto (configurable). Jugador puede forzar rotación.

---

## 5. Plan de 3 fases

### Fase 1 — Math + RGS (4-6 semanas)

**En curso.** Sin cliente todavía, solo backend + simulador.

Entregables:
- [x] `docs/own-games/jokers-jewels/00-overview.md` (este doc)
- [ ] `docs/own-games/jokers-jewels/math.md` (paytable + reel strips + RTP simulation)
- [ ] `packages/games-shared/` (provably fair + RNG + Monte Carlo helper)
- [ ] `packages/games-jokers-jewels/` (math + spin + simulator)
- [ ] Suite de tests:
  - Math RTP convergence (10M rounds, RTP empírico = 96.50% ± 0.1%)
  - Provably fair reproducibility (1000 rounds, recreable from seeds)
  - Edge cases: max win, all wild, empty board
- [ ] Iteración de reel strips hasta converger en el RTP target

**Cierre Fase 1**: poder correr `pnpm --filter @casino/games-jokers-jewels simulate -- --spins 10000000` y ver RTP = 96.5% ± 0.1%.

### Fase 2 — Cliente PixiJS básico (4-6 semanas)

Sin Spine ni polish premium, assets de stock o AI-generated. Solo: reels giran, paylines se visualizan, wins se muestran.

Entregables:
- `apps/games/jokers-jewels/` (Vite + PixiJS + TypeScript)
- Reels que giran con animación CSS-like (no Spine todavía)
- Paytable visualizada en UI
- Bet controls + spin button + balance display
- Win line animations básicas (highlight + número del payout)
- Mobile responsive
- Integración con la wallet API de la plataforma (vía `OwnGamesProvider` adapter)

**Cierre Fase 2**: el dueño logra jugar el slot desde `/play/games/jokers-jewels/play/iframe` y la plata se mueve.

### Fase 3 — Polish (4-8 semanas)

Para que se vea "profesional", no "DIY".

Entregables:
- Animaciones Spine de los símbolos (joker bailando, gemas brillando, corona girando).
- Sound design (música ambient, spin sound, win sounds escalonados por tier).
- Transiciones premium (anticipation reveals, big win modals).
- Optimización de bundle (lazy load assets).
- Mobile polish (touch gestures, haptic).

**Cierre Fase 3**: cuando un usuario externo prueba el juego y dice "se siente como un slot real, no un MVP".

### Tiempo total realista

3-5 meses part-time. Si parte del polish queda para después, Fase 1+2 en ~2.5 meses te deja con un slot funcional jugable.

---

## 6. Decisiones técnicas locked

| Decisión | Locked? | Razón |
|---|---|---|
| RTP 96.50% | ✅ | Match con el juego original |
| 5 paylines | ✅ | Match con el juego original |
| Math en `packages/games-jokers-jewels/` (no en RGS separado todavía) | ✅ | Minimizar fricción Fase 1. Refactor a RGS en Fase 3+ |
| Provably fair desde día 1 | ✅ | Decisión global del proyecto |
| TypeScript estricto | ✅ | Decisión global del proyecto |
| Cliente: **PixiJS + Spine + GSAP** (Fase 2+) | ✅ | Decisión de stack documentada en [`../01-stack-decision.md`](../01-stack-decision.md) |
| Bet por línea fija (todas las líneas activas siempre) | ✅ | Match con el original. El usuario no puede activar/desactivar líneas |

---

## 7. Decisiones pendientes (a definir cuando emerjan)

- Nombre comercial real (para cuando renombremos antes de producción).
- Si soportamos **auto-spin** (Pragmatic lo tiene; sumarlo en Fase 3 si hay tiempo).
- Si soportamos **turbo spin** (skip de la animación de spin para jugadores rápidos).
- Audio: ¿usamos sounds de stock o generamos con suno.ai?
- Mobile: ¿horizontal lock o también vertical?
- Replayer: ¿el jugador puede ver round del pasado animado de nuevo? (típicamente sí en slots premium)

---

## 8. No-goals explícitos (lo que NO hacemos en esta primera versión)

- Sin features bonus (sin free spins, sin cascade, sin pick-and-click).
- Sin jackpot progresivo.
- Sin tournament mode dentro del juego.
- Sin multi-jugador (es slot single-player).
- Sin certificación oficial (eCOGRA / GLI) — solo provably fair propio.
- Sin multi-currency display (todo en chips, sin conversión visual a fiat).
- Sin gamble feature (típico en slots: "doblá tu premio con cara/cruz") — Pragmatic's Joker's Jewels no lo tiene, nosotros tampoco.
