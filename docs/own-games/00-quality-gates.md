# Juegos Propios · 00b · Quality Gates

> **Política**: "Calidad sobre velocidad" (decidido 2026-05-25).
> Cada juego propio pasa por esta checklist antes de avanzar de fase.
> Mejor 1 juego perfecto que 5 a medias.

Esta es la **checklist obligatoria** que cada juego propio debe cumplir antes de marcarse como completado en cada fase. No es opcional. Si un item no cumple, la fase NO se cierra y NO se avanza a la siguiente.

---

## Fase 1 — Math + RGS + Provably fair

Backend del juego sin cliente UI. Validación de que el math es correcto, reproducible y robusto.

### G1.1 — Math correctness

- [ ] **G1.1.1** Paytable + reel strips (o equivalente) documentados en `docs/own-games/<slug>/math.md`.
- [ ] **G1.1.2** Algoritmo de spin documentado paso por paso.
- [ ] **G1.1.3** Algoritmo de evaluación de wins documentado.
- [ ] **G1.1.4** RTP target definido explícitamente con justificación.
- [ ] **G1.1.5** RTP empírico sobre **10M+ spins** Monte Carlo **dentro de ±0.1%** del target.
- [ ] **G1.1.6** RTP estable: corrida adicional de **100M spins** confirma RTP dentro de ±0.05% del observado en 10M.
- [ ] **G1.1.7** Histórico de calibración documentado en `math.md §9` (snapshot por iteración).

### G1.2 — Volatility y distribución

- [ ] **G1.2.1** Hit frequency medida y documentada (% de spins con win > 0).
- [ ] **G1.2.2** Standard deviation del payout medida (proxy de volatility).
- [ ] **G1.2.3** Distribución por buckets logarítmicos del payout en simulación de 10M+ documentada.
- [ ] **G1.2.4** Max win observado en 10M+ documentado vs cap teórico.

### G1.3 — Edge cases del math

- [ ] **G1.3.1** Test explícito del **cap del max win** (forzar seed que dispare el cap, validar truncado).
- [ ] **G1.3.2** Test del **outcome más raro** (5 wilds en línea, o equivalente del juego) — forzar seed que lo produzca, validar pago correcto.
- [ ] **G1.3.3** Test de **spin con win = 0** (no match en ninguna línea).
- [ ] **G1.3.4** Test de **bet decimales** (0.01, 0.001, 1.7777, etc.).
- [ ] **G1.3.5** Test de **bet 0 o negativo** — debe tirar error claro.
- [ ] **G1.3.6** Test de **bet máximo razonable** (Number.MAX_SAFE_INTEGER) — no debe overflow ni romper.
- [ ] **G1.3.7** Test de **wild behavior** (si aplica) — wilds que sustituyen, wilds que NO sustituyen, edge cases.

### G1.4 — Provably fair

- [ ] **G1.4.1** Server seed generado con `crypto.randomBytes` (256 bits mínimo).
- [ ] **G1.4.2** Commit hash (SHA-256 del server seed) publicable antes del round.
- [ ] **G1.4.3** Round seed = SHA256(server_seed + client_seed + nonce).
- [ ] **G1.4.4** Test de **reproducibilidad end-to-end**: 1000 spins guardando (seed, nonce, outcome). Re-generar todos desde los seeds y validar que matchean byte-by-byte.
- [ ] **G1.4.5** Test de **commit verification**: el hash publicado se corresponde con el seed revelado.
- [ ] **G1.4.6** Documentación al jugador sobre cómo verificar fairness manualmente (`docs/own-games/<slug>/provably-fair.md` o sección del overview).

### G1.5 — Determinismo del RNG

- [ ] **G1.5.1** RNG es **determinístico** desde seed (mismo seed → misma secuencia).
- [ ] **G1.5.2** RNG produce floats uniformes en [0, 1) — test sobre 100k+ muestras (avg ≈ 0.5 ± 0.005).
- [ ] **G1.5.3** RNG no se "atasca" después de consumir el seed inicial (chain ilimitado).
- [ ] **G1.5.4** RNG rechaza seeds de tamaño incorrecto con error claro.

### G1.6 — CLI / herramientas

- [ ] **G1.6.1** Script CLI para correr el simulador (`pnpm --filter @casino/games-<slug> simulate`).
- [ ] **G1.6.2** CLI valida sus argumentos (rechaza `--spins -1`, `--spins abc`, etc.).
- [ ] **G1.6.3** Output del simulador legible (RTP, hit freq, distribución, max win, performance).
- [ ] **G1.6.4** Script de calibración auto (`calibrate.ts`) que itera reel strips hasta convergir al RTP target.

### G1.7 — Tests + lint + types

- [ ] **G1.7.1** **100% de tests unitarios verde** (cobertura objetivo: math, evaluate, spin, edge cases).
- [ ] **G1.7.2** `pnpm type-check` exit 0.
- [ ] **G1.7.3** `pnpm lint` exit 0 (sin warnings nuevos significativos).
- [ ] **G1.7.4** Tests corren en < 30s (no incluye Monte Carlo grande).
- [ ] **G1.7.5** El Monte Carlo 10M corre en < 2 minutos.

### G1.8 — Documentación

- [ ] **G1.8.1** `docs/own-games/<slug>/00-overview.md` completo.
- [ ] **G1.8.2** `docs/own-games/<slug>/math.md` completo con tabla histórica de calibración.
- [ ] **G1.8.3** Aviso legal interno (si aplica clone): rename + reskin antes de prod.
- [ ] **G1.8.4** Decisiones técnicas locked vs pendientes documentadas.

**Salida Fase 1**: todos los items ✅. Si alguno está ❌, NO se avanza a Fase 2.

---

## Fase 2 — Cliente UI básico

Cliente PixiJS / Canvas / etc. que renderiza el outcome del RGS. Sin polish premium.

### G2.1 — Integración con RGS

- [ ] **G2.1.1** Cliente consume el RGS via HTTP/WebSocket usando el contrato definido.
- [ ] **G2.1.2** Cliente jamás ejecuta math (validable por audit del bundle).
- [ ] **G2.1.3** Cliente maneja errores del RGS (timeout, 500, network error) con feedback visual al usuario.
- [ ] **G2.1.4** Test E2E: spin completo end-to-end (UI click → RGS → wallet → respuesta → animación).

### G2.2 — UI funcional

- [ ] **G2.2.1** Reels animados (giran y paran en el outcome del server).
- [ ] **G2.2.2** Bet controls (input + botones +/−) con validación.
- [ ] **G2.2.3** Spin button con estado (idle, spinning, disabled).
- [ ] **G2.2.4** Balance display que se actualiza después de cada spin.
- [ ] **G2.2.5** Paytable visualizada (al menos como modal/tooltip).
- [ ] **G2.2.6** Win line animations (highlight + payout reveal).
- [ ] **G2.2.7** Empty state cuando no hay datos / cargando / error.

### G2.3 — Responsive + mobile

- [ ] **G2.3.1** Funciona en mobile (375px width mínimo) sin scroll horizontal.
- [ ] **G2.3.2** Tap targets ≥ 44×44px (Apple HIG).
- [ ] **G2.3.3** Funciona en desktop (1280px+) sin estirarse mal.
- [ ] **G2.3.4** Probado en celular real (no solo devtools).

### G2.4 — Integración a plataforma

- [ ] **G2.4.1** Adapter `OwnGamesProvider` que cumple `IGameProvider`.
- [ ] **G2.4.2** Wallet integration: bet + win via wallet API correctamente.
- [ ] **G2.4.3** Idempotencia testeada (mismo bet 2 veces → no duplica).
- [ ] **G2.4.4** Concurrencia testeada (50 jugadores simultáneos sin race condition).

### G2.5 — Performance

- [ ] **G2.5.1** Bundle inicial < 1MB gzipped.
- [ ] **G2.5.2** First spin desde click < 2s en mobile 4G.
- [ ] **G2.5.3** Frame rate ≥ 30fps en mobile mediano (iPhone SE-tier).
- [ ] **G2.5.4** Sin memory leaks (jugar 100 spins seguidos sin growth de heap).

### G2.6 — Accessibility básico

- [ ] **G2.6.1** Axe-core: 0 violaciones WCAG 2.1 AA.
- [ ] **G2.6.2** Funciona con keyboard navigation (tab + enter/space).
- [ ] **G2.6.3** Contraste de texto pasa WCAG AA.
- [ ] **G2.6.4** `prefers-reduced-motion`: sin animaciones que mareen.

### G2.7 — Tests + types + lint

- [ ] **G2.7.1** Tests unitarios del cliente cubren componentes críticos (reels, paytable, controls).
- [ ] **G2.7.2** Test E2E Playwright para el flujo crítico (login → abrir juego → spin → ver resultado).
- [ ] **G2.7.3** type-check + lint exit 0.

**Salida Fase 2**: todos los items ✅. Juego jugable end-to-end, sin polish premium pero estable.

---

## Fase 3 — Polish

Para que se sienta profesional, no DIY.

### G3.1 — Animaciones premium

- [ ] **G3.1.1** Animaciones de símbolos (Spine 2D para slots) o equivalente para el juego.
- [ ] **G3.1.2** Transiciones suaves entre estados (idle → spin → reveal → idle).
- [ ] **G3.1.3** Anticipation reveals (para premios grandes, build-up antes del reveal).
- [ ] **G3.1.4** Big win modal con confetti / sonido especial cuando supera N× bet.

### G3.2 — Sound design

- [ ] **G3.2.1** Música ambient looped (mutable).
- [ ] **G3.2.2** Spin sound.
- [ ] **G3.2.3** Win sounds escalonados por tier (small win, medium, big, jackpot).
- [ ] **G3.2.4** UI sounds (click, hover, button press).
- [ ] **G3.2.5** Mute global persistente (localStorage).

### G3.3 — Polish mobile

- [ ] **G3.3.1** Touch gestures (swipe para abrir paytable, etc.).
- [ ] **G3.3.2** Haptic feedback (si el navegador soporta).
- [ ] **G3.3.3** Address bar de iOS no tapa controles importantes.

### G3.4 — Optimización

- [ ] **G3.4.1** Lazy load de assets pesados (música, sprites grandes).
- [ ] **G3.4.2** Preload de assets críticos en background.
- [ ] **G3.4.3** Bundle final < 2MB gzipped con polish completo.

### G3.5 — Test de usabilidad real

- [ ] **G3.5.1** Usuario externo prueba el juego y dice "se siente como un slot real".
- [ ] **G3.5.2** Sesión de juego de 15+ minutos sin bugs visibles.
- [ ] **G3.5.3** Bugs encontrados resueltos.

**Salida Fase 3**: juego listo para producción real (con el rename + reskin si es clone).

---

## Cómo usar esta checklist

1. **Al arrancar un juego nuevo**: copiar este doc a `docs/own-games/<slug>/quality-gates.md` y marcar items relevantes (algunos juegos pueden NO tener "wild behavior" si no aplica, por ejemplo).

2. **Al cerrar una fase**: marcar todos los checkboxes en el doc del juego. Si alguno falla, NO avanzar. Documentar por qué falla y plan para resolver.

3. **En cada PR/commit**: si tocás algo de math o crítico, validar que el bloque relevante de quality gates sigue cumpliendo.

4. **Auditoría retrospectiva**: si en producción aparece un bug que un quality gate hubiera detectado, **agregar el gate faltante** a este doc para que el próximo juego no caiga en lo mismo.

---

## Notas

- Esta checklist es **viva**: se actualiza cuando aprendemos algo nuevo.
- Hay tensión natural con "ship fast" — el dueño explícitamente eligió calidad. Si en algún momento se cambia esa decisión, documentarla acá con fecha y razón.
- Para juegos crash, mini-games (mines/plinko/dice), aplica subset de esta checklist (ej: G1.1 sí, G1.7.4 puede ser distinto, etc.). Cada juego identifica qué gates aplican en su `quality-gates.md` específico.
