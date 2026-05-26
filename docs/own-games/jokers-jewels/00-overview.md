# Joker's Jewels Â· Overview

> Estado: **Fase 1 â€” Math + RGS** en curso (iniciada Sprint 54 / 2026-05-25).
> Primer juego propio de la plataforma.

Clone funcional del slot **Joker's Jewels** de Pragmatic Play. Elegido como primer juego propio por ser el slot mÃ¡s simple del catÃ¡logo Pragmatic-tier (sin features: sin free spins, sin cascade, sin bonus rounds), lo cual lo hace el punto de entrada mÃ¡s razonable al stack de slots para un dev solo part-time.

---

## 1. Aviso legal interno

DecisiÃ³n del dueÃ±o 2026-05-25: arrancamos con **copia directa** (nombre + visuales + math) **para uso interno / piloto cerrado**. El riesgo legal mientras esto no estÃ© expuesto comercialmente es ~0.

**Antes de exponer a primer cliente externo / producciÃ³n real / venta de la plataforma**:

- [ ] Renombrar el juego (sugerencias: "Crown Jester", "Royal Joker", "Diamond Jester")
- [ ] Reskin de los assets â€” los sprites pixel-perfect de Pragmatic son copyright de Pragmatic. Generar nuevos con AI / stock.
- [ ] Cambiar el logo / tÃ­tulo.

El math model y la mecÃ¡nica son fÃ³rmulas matemÃ¡ticas â€” **no son protegibles**. Esos se quedan.

Cuando se active ese checkpoint, abrir issue "Rename Joker's Jewels antes de prod".

---

## 2. MecÃ¡nica del juego (lo que copiamos)

| ParÃ¡metro | Valor |
|---|---|
| Reels | 5 |
| Filas visibles | 3 |
| Paylines | **5** (no 10, no 20, no 243 â€” solo 5) |
| Pago | Izquierda a derecha, mÃ­nimo 3 iguales consecutivos |
| Wild | Joker (sustituye a cualquier sÃ­mbolo, paga como el mÃ¡s alto) |
| Scatter / bonus | Ninguno (la "corona" es un sÃ­mbolo regular de alto pago, no scatter) |
| Free spins / bonus rounds | **Ninguno** |
| RTP target | **96.50%** |
| Volatility target | Media (4 sobre 5 en escala Pragmatic) |
| Max win | 1000Ã— bet (cap del juego) |
| Hit frequency | ~30% (medida en simulaciÃ³n, no target) |
| Bet range | Configurable por tenant. Default: 0.10 - 100 chips |

### Las 5 paylines

```
Reel:    1 2 3 4 5

LÃ­nea 1: â”€ â”€ â”€ â”€ â”€   (top)
LÃ­nea 2: â• â• â• â• â•   (middle)
LÃ­nea 3: â”€ â”€ â”€ â”€ â”€   (bottom)
LÃ­nea 4: â•² â•± â•² â•± â•²   (V invertida: top-mid-bot-mid-top)
LÃ­nea 5: â•± â•² â•± â•² â•±   (V normal: bot-mid-top-mid-bot)
```

### SÃ­mbolos

8 sÃ­mbolos en total (incluido el wild):

| Symbol code | Nombre | Tier | Pagos 5/4/3 (Ã— bet por lÃ­nea) |
|---|---|---|---|
| `joker` | Joker (wild) | T1 | 200 / 40 / 4 |
| `crown` | Corona | T2 | 50 / 10 / 2 |
| `mandolin` | Mandolina | T3 | 40 / 8 / 2 |
| `boots` | Botas rosadas | T3 | 40 / 8 / 2 |
| `bolos` | Bolos (bowling pins) | T4 | 8 / 2 / 0.4 |
| `ruby` | RubÃ­ (rojo) | T4 | 8 / 2 / 0.4 |
| `sapphire` | Zafiro (azul) | T4 | 8 / 2 / 0.4 |
| `emerald` | Esmeralda (verde) | T4 | 8 / 2 / 0.4 |

> Las 4 gemas pagan igual entre sÃ­ â€” son intercambiables matemÃ¡ticamente. Visualmente distintas para variedad estÃ©tica.

> Los pagos estÃ¡n en **multiplicador del bet por lÃ­nea**. Si el jugador apuesta 1 chip total (0.2 por lÃ­nea Ã— 5 lÃ­neas), un 5 de joker paga 200 Ã— 0.2 = 40 chips netos.

Ver paytable + reel strips completas en [`math.md`](./math.md).

---

## 3. Wild behavior

Joker es el Ãºnico wild:

- Sustituye a cualquier sÃ­mbolo para completar una lÃ­nea ganadora.
- **No paga por su cuenta** salvo si forma su propia combinaciÃ³n (5 jokers = 200Ã—, 4 jokers = 40Ã—, etc.).
- Si una lÃ­nea tiene 5 jokers, paga el premio del joker (200Ã—) que es el mÃ¡s alto del juego.

---

## 4. Provably fair

EstÃ¡ndar del proyecto (ver [`../00-overview.md Â§5`](../00-overview.md#5-provably-fair)):

1. Server genera `server_seed` (32 bytes random).
2. Server publica `SHA256(server_seed)` al cliente.
3. Cliente provee `client_seed` (custom o auto).
4. Para cada spin: `round_seed = SHA256(server_seed + client_seed + nonce)`.
5. `round_seed` alimenta el RNG determinÃ­stico que decide los sÃ­mbolos de los 5 reels.
6. DespuÃ©s del round, server revela `server_seed` para que el jugador pueda recrear el resultado.

RotaciÃ³n de `server_seed`: cada **1000 spins** por defecto (configurable). Jugador puede forzar rotaciÃ³n.

---

## 5. Plan de 3 fases

### Fase 1 â€” Math + RGS (4-6 semanas)

**En curso.** Sin cliente todavÃ­a, solo backend + simulador.

Entregables:
- [x] `docs/own-games/jokers-jewels/00-overview.md` (este doc)
- [ ] `docs/own-games/jokers-jewels/math.md` (paytable + reel strips + RTP simulation)
- [ ] `packages/games-shared/` (provably fair + RNG + Monte Carlo helper)
- [ ] `packages/games-jokers-jewels/` (math + spin + simulator)
- [ ] Suite de tests:
  - Math RTP convergence (10M rounds, RTP empÃ­rico = 96.50% Â± 0.1%)
  - Provably fair reproducibility (1000 rounds, recreable from seeds)
  - Edge cases: max win, all wild, empty board
- [ ] IteraciÃ³n de reel strips hasta converger en el RTP target

**Cierre Fase 1**: poder correr `pnpm --filter @casino/games-jokers-jewels simulate -- --spins 10000000` y ver RTP = 96.5% Â± 0.1%.

### Fase 2 â€” Cliente PixiJS bÃ¡sico (4-6 semanas)

Sin Spine ni polish premium, assets de stock o AI-generated. Solo: reels giran, paylines se visualizan, wins se muestran.

Entregables:
- `apps/games/jokers-jewels/` (Vite + PixiJS + TypeScript)
- Reels que giran con animaciÃ³n CSS-like (no Spine todavÃ­a)
- Paytable visualizada en UI
- Bet controls + spin button + balance display
- Win line animations bÃ¡sicas (highlight + nÃºmero del payout)
- Mobile responsive
- IntegraciÃ³n con la wallet API de la plataforma (vÃ­a `OwnGamesProvider` adapter)

**Cierre Fase 2**: el dueÃ±o logra jugar el slot desde `/play/games/jokers-jewels/play/iframe` y la plata se mueve.

### Fase 3 â€” Polish (4-8 semanas)

Para que se vea "profesional", no "DIY".

Entregables:
- Animaciones Spine de los sÃ­mbolos (joker bailando, gemas brillando, corona girando).
- Sound design (mÃºsica ambient, spin sound, win sounds escalonados por tier).
- Transiciones premium (anticipation reveals, big win modals).
- OptimizaciÃ³n de bundle (lazy load assets).
- Mobile polish (touch gestures, haptic).

**Cierre Fase 3**: cuando un usuario externo prueba el juego y dice "se siente como un slot real, no un MVP".

### Tiempo total realista

3-5 meses part-time. Si parte del polish queda para despuÃ©s, Fase 1+2 en ~2.5 meses te deja con un slot funcional jugable.

---

## 6. Decisiones tÃ©cnicas locked

| DecisiÃ³n | Locked? | RazÃ³n |
|---|---|---|
| RTP 96.50% | âœ… | Match con el juego original |
| 5 paylines | âœ… | Match con el juego original |
| Math en `packages/games-jokers-jewels/` (no en RGS separado todavÃ­a) | âœ… | Minimizar fricciÃ³n Fase 1. Refactor a RGS en Fase 3+ |
| Provably fair desde dÃ­a 1 | âœ… | DecisiÃ³n global del proyecto |
| TypeScript estricto | âœ… | DecisiÃ³n global del proyecto |
| Cliente: **PixiJS + Spine + GSAP** (Fase 2+) | âœ… | DecisiÃ³n de stack documentada en [`../01-stack-decision.md`](../01-stack-decision.md) |
| Bet por lÃ­nea fija (todas las lÃ­neas activas siempre) | âœ… | Match con el original. El usuario no puede activar/desactivar lÃ­neas |

---

## 7. Decisiones pendientes (a definir cuando emerjan)

- Nombre comercial real (para cuando renombremos antes de producciÃ³n).
- Si soportamos **auto-spin** (Pragmatic lo tiene; sumarlo en Fase 3 si hay tiempo).
- Si soportamos **turbo spin** (skip de la animaciÃ³n de spin para jugadores rÃ¡pidos).
- Audio: Â¿usamos sounds de stock o generamos con suno.ai?
- Mobile: Â¿horizontal lock o tambiÃ©n vertical?
- Replayer: Â¿el jugador puede ver round del pasado animado de nuevo? (tÃ­picamente sÃ­ en slots premium)

---

## 8. No-goals explÃ­citos (lo que NO hacemos en esta primera versiÃ³n)

- Sin features bonus (sin free spins, sin cascade, sin pick-and-click).
- Sin jackpot progresivo.
- Sin tournament mode dentro del juego.
- Sin multi-jugador (es slot single-player).
- Sin certificaciÃ³n oficial (eCOGRA / GLI) â€” solo provably fair propio.
- Sin multi-currency display (todo en chips, sin conversiÃ³n visual a fiat).
- Sin gamble feature (tÃ­pico en slots: "doblÃ¡ tu premio con cara/cruz") â€” Pragmatic's Joker's Jewels no lo tiene, nosotros tampoco.

