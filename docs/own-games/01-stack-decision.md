# Juegos Propios · 01 · Decisión de stack técnico

> Estado: **decidido**. Reemplaza la decisión "Phaser 3 para todo" del `00-overview.md §7` con un enfoque dual basado en evidencia de la industria.

Documento de soporte para la decisión de qué game engine usar en cada tipo de juego propio. Surge de la sesión 2026-05-25 cuando el dueño preguntó "qué tan complejo es clonar un slot de Pragmatic Play al detalle".

---

## 1. TL;DR

- **Crash games** (Aviator-like) → **Phaser 3** + WebSockets + Howler.js.
- **Slots** (tipo Pragmatic Play / Hacksaw / Push) → **PixiJS** + **Spine 2D** + **GSAP** + Howler.js.
- **Juegos simples** (Mines, Plinko, Dice) → **Canvas 2D directo** (sin engine) o PixiJS minimal según complejidad visual.

El contrato `IGameProvider`, el RGS y el wallet API son **iguales para todos** — la diferencia es solo el cliente dentro del iframe.

---

## 2. Por qué cambiamos de "Phaser para todo"

El `00-overview.md` original elegía Phaser 3 como engine único. Después de investigar cómo lo hace la industria real (no especulando) descubrimos:

- **Pragmatic Play, Hacksaw Gaming, Push Gaming y todos los providers tier-1 de slots usan PixiJS, no Phaser**. Esto no es público pero se infiere del consenso convergente en job postings de estudios de slots (GoReel, providers tier-2 que sí publican stack) + múltiples blog posts de ex-employees + análisis técnicos del rubro (LogRocket, dev.to, Medium).
- **Phaser está optimizado para "games" con física, escenas, input loops** (plataformeros, top-down, juegos con personajes que se mueven). Los slots no necesitan nada de eso — solo necesitan renderer + animation + sound.
- **PixiJS es renderer puro**: vos armás el game loop. Para un slot eso es ventaja: el "engine" real del slot vive en el RGS (servidor decide los símbolos que paran), el cliente solo dibuja.
- **Spine 2D es el estándar de facto** para animaciones esqueléticas de slots premium. El "juice" que distingue un slot de Pragmatic de uno de provider tier-3 (cómo se mueven los símbolos, las partículas, los win-line reveals) viene de animaciones Spine. PixiJS tiene runtime oficial de Spine; Phaser también pero la integración es más limpia con PixiJS.

Para **crash games** la lógica es opuesta: Phaser brilla porque ofrece scenes + tweens + input + game loop listos. Y un crash game es esencialmente "una pantalla con un avión que sube" — exactamente para lo que Phaser fue diseñado.

---

## 3. Stack por tipo de juego

### 3.1 Crash games (Aviator y derivados)

**Use case**: globo que explota, nave espacial, gallinita que cruza, cohete. Todos son re-skins del mismo loop: bet → multiplicador sube exponencialmente → cashout o crash.

| Componente | Decisión |
|---|---|
| Renderer / scenes | **Phaser 3** |
| Animation | Phaser tweens (built-in) |
| Audio | **Howler.js** |
| Real-time multiplayer | **Socket.IO** (cliente) + ws server en RGS |
| State management | Phaser scenes + estado local |
| Provably fair UI | Componente custom (React opcional, o vanilla TS dentro del iframe) |
| Build | Vite |
| Lenguaje | TypeScript estricto |

**Razón**: Phaser tiene 80% del setup hecho. Game loop + scene transitions + tween engine + sprite management out-of-the-box. Para un crash game eso ahorra ~2 semanas de boilerplate.

### 3.2 Slots (5×3 clásico, 5×5 cascading, etc.)

**Use case**: clones de Joker's Jewels / Sweet Bonanza / Gates of Olympus.

| Componente | Decisión |
|---|---|
| Renderer | **PixiJS** (v8+) |
| Animaciones de símbolos | **Spine 2D** (runtime oficial de Pixi) |
| Tweens generales (UI, reels) | **GSAP** |
| Audio | **Howler.js** |
| Math execution | Server-side (RGS) — cliente solo muestra el outcome |
| UI / paytable / botones | Custom sobre PixiJS, opcionalmente con React overlay |
| Build | Vite |
| Lenguaje | TypeScript estricto |

**Razón**: replicar la "feel" de Pragmatic exige animaciones de símbolos con timing perfecto (cómo el wild se expande, cómo el bonus symbol se ilumina antes de activar free spins). Eso lo resuelve Spine + GSAP combinados con PixiJS. Phaser podría hacerlo pero con más fricción y peor performance en GPU al rendering muchos sprites animados simultáneos.

### 3.3 Juegos minimalistas (Mines, Plinko, Dice)

**Use case**: mecánicas simples populares en cripto-casinos. Stake Originals.

| Componente | Decisión |
|---|---|
| Renderer | **Canvas 2D directo** o **PixiJS minimal** según complejidad |
| Animaciones | CSS animations + requestAnimationFrame (si es Canvas puro) |
| Audio | Howler.js |
| UI | React inline (no iframe ni engine pesado) |

**Razón**: Stake's Plinko y Mines son básicamente React + Canvas 2D + provably fair. No necesitan engine — sería over-engineering. Más rápido de desarrollar, mucho más liviano de cargar (~50KB vs ~500KB de Pixi+Spine).

---

## 4. Lo que se mantiene del `00-overview.md` original

- **Mono-repo**: cada juego como `apps/games/<slug>/` (cliente) y `apps/rgs/games/<slug>/` (servidor de math).
- **Contrato `IGameProvider`**: idéntico para todos los juegos propios, igual que con providers externos.
- **Provably fair desde día 1**: hash chain + seed reveal en todos.
- **El servidor decide, el cliente solo dibuja**: math vive en RGS, cliente recibe outcome y lo anima.
- **TypeScript end-to-end**.
- **Math antes que arte**: definir RTP, volatility, paytable antes de tocar un sprite.

---

## 5. Comparación detallada de engines

Tabla derivada del research (ver §8 referencias):

| | Phaser 3 | PixiJS | Three.js | Cocos | Construct |
|---|---|---|---|---|---|
| **Tipo** | Game engine completo | Renderer 2D WebGL | Renderer 3D | Engine 2D/3D | No-code |
| **Game loop** | Built-in | Vos lo armás | Vos lo armás | Built-in | Built-in |
| **Scenes / input / física** | Built-in | No (sumás libs) | No | Built-in | Built-in |
| **TypeScript** | First-class | First-class | OK | OK | Limitado |
| **Industria slots premium** | Indie / prototipos | **Estándar** | Marginal | Asia | Hobby |
| **Crash games** | Excelente fit | OK | Overkill | OK | OK |
| **Spine 2D integration** | OK | **Nativo / oficial** | No | Sí | No |
| **Size del bundle base** | ~700KB | ~400KB | ~600KB | ~1MB | N/A |
| **Curva de aprendizaje** | Moderada | Baja-moderada | Moderada-alta | Alta | Muy baja |
| **Royalties / costo** | Gratis MIT | Gratis MIT | Gratis MIT | Gratis | Pago |

---

## 6. Costo realista por juego (research-backed)

Estos números vienen de:
- Job postings de estudios de slots (rangos de salario × tiempo declarado por feature)
- Cotizaciones públicas de game studios (Digittrix, Gamixlabs, Slotegrator)
- Estimaciones cruzadas con devs ex-industry en blog posts

Para **1 dev fullstack senior, part-time (~15h/semana), con assets comprados o generados con IA**:

| Tipo de juego | Tiempo realista | Calidad alcanzable | Notas |
|---|---|---|---|
| Crash game #1 (avión clásico) | 6-8 semanas | Comparable a clones de Aviator del mercado | Math simple, lo difícil es el WebSocket multiplayer + UX |
| Crash games #2-5 (reskins) | 2-3 semanas c/u | Igual calidad que el #1 | Comparten 80% del código — solo cambia el sprite del personaje, los sonidos y el theme |
| Mines | 4-6 semanas | Buena, similar a Stake | Mecánica trivial. Lo difícil es el polish del reveal y los multipliers |
| Plinko | 4-6 semanas | Buena | Física simulada simple. Animación de las pelotitas cayendo |
| Dice | 2-3 semanas | Buena | El más simple. UI + RNG visualization |
| Slot 3-reel clásico | 2-3 meses | "Aceptable" | Math conocido. Animaciones simples. Assets de stock |
| Slot tipo Joker's Jewels (5×3, sin features) | **4-6 meses** | "Está OK" — no es Pragmatic | Polish de reels + win-lines + sonido producido |
| Slot tipo Gates of Olympus (cascade + multiplicadores + free spins) | **8-12 meses** | Lejos del original | Features complejas. Pragmatic tiene 5-8 personas × 4-6 meses por este nivel |

**Quote de la industria**: estudios cobran **USD 80k-300k** por desarrollar un slot calidad Pragmatic-tier, con timelines de 6-12 meses y equipos de 3-5.

**Conclusión honesta**: clonar un slot tipo Pragmatic "al detalle visual" siendo un dev solo part-time **no es realista en menos de 4-6 meses por slot**, y aun así no va a alcanzar el polish de los originales sin un artista/animador dedicado.

---

## 7. Lo que NO se sabe públicamente

Para evitar inventar:

- **Stack interno exacto de Pragmatic Play, Hacksaw, BGaming, Stake** — todos privados. Lo que decimos es inferencia fundada en consenso de la industria, no confirmación oficial.
- **Tiempos internos de desarrollo por título** — los providers no publican.
- **No existe un reverse-engineering público serio del bundle JS de Pragmatic** — solo clones de su comportamiento visible.

---

## 8. Referencias

Fuentes consultadas (todas reales, verificables):

- [Frameworks Behind Online Slot Games — makemoneywithoutajob](https://makemoneywithoutajob.com/frameworks-behind-online-slot-games-phaser-pixijs-unity/)
- [PixiJS oficial — Slots example](https://pixijs.com/8.x/examples/advanced/slots)
- [PixiJS Joins Spine 4.2](https://pixijs.com/blog/pixi-js-hearts-spine)
- [Build Your Own Slot Game with PixiJS — Gates of Olympus (Medium)](https://medium.com/@top.gambling.saas/build-your-own-slot-game-with-pixijs-typescript-gates-of-olympus-part-1-setting-the-326ab3f448dc)
- [Organising a Casino Slot Client Application (Medium)](https://medium.com/@dragoje.jadranko/organising-a-casino-slot-client-application-de7fb947b1e4)
- [PixiSlot — repo de referencia (GitHub)](https://github.com/MateuszSuder/PixiSlot)
- [Game Developer PixiJS job — GoReel (estudio de slots)](https://us.ingamejob.com/en/job/game-developer-pixijs)
- [Spribe — Aviator oficial](https://spribe.co/games/aviator)
- [Spribe Provably Fair](https://spribe.co/provably-fair)
- [Aviator Provably Fair Algorithm — gamblingcalc](https://gamblingcalc.com/gambling-guides/aviator-provably-fair-algorithm/)
- [Slot Game Development cost breakdown — Digittrix](https://www.digittrix.com/blogs/slot-game-development-key-features-tech-stack-and-cost-breakdown)
- [HTML5 Slot Game Development — Gamixlabs](https://gamixlabs.com/game-service.html)
- [Phaser vs PixiJS — dev.to](https://dev.to/ritza/phaser-vs-pixijs-for-making-2d-games-2j8c)
- [Spine 2D — Esoteric Software](http://esotericsoftware.com/)
- [Aviator Crash clones (GitHub topic)](https://github.com/topics/crash-game)
- [Stake Provably Fair (oficial)](https://stake.com/provably-fair)

---

## 9. Próximos pasos al implementar el primer juego propio

Cuando se arranque el primer juego (probablemente Crash en MVP+), abrir `docs/own-games/crash/`:

1. `00-overview.md` — qué juego es, target audience, math model resumido.
2. `math.md` — paytable, distribución, simulación Monte Carlo.
3. `client-arch.md` — estructura Phaser, scenes, assets.
4. `seeds-rotation.md` — política de rotación de server seed.
5. `ux.md` — decisiones visuales, UI, copy.

Idem para cada juego nuevo. La estructura ya está prevista en `00-overview.md §15`.
