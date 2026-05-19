# Accessibility Checklist

> **Status MVP**: la UI fue construida con foco en performance + UX pero
> SIN auditoría formal de accesibilidad. Este checklist define la baseline
> mínima + qué falta para cumplir WCAG 2.1 AA en MVP.

## Por qué importa

- **Compliance**: muchos mercados regulados requieren accesibilidad básica
  para apps de juego.
- **Operadores con discapacidad** (cajeros, soporte): usan teclado intensivo
  + lectores de pantalla.
- **SEO**: las prácticas de a11y mejoran indexación.

## Estado actual (Sprint 38)

Hecho por convención, no por test formal:

- ✓ Inputs con `<Label>` asociado (admin forms).
- ✓ Buttons con `aria-label` cuando son icon-only (e.g. logout en sidebar).
- ✓ Imágenes con `alt=` (logo del player header).
- ✓ Contraste de colores razonable (rojo accent sobre fondo dark).
- ✓ Modales con `role="dialog"` + click-outside-closes (Radix Dialog).
- ✓ Toast notifications con `role="alert"` (Sonner default).

Pendiente:

- ✗ Audit formal con axe-core o Lighthouse.
- ✗ Tab order revisado en flows críticos (login, deposit, game spin).
- ✗ Screen reader testing (NVDA / VoiceOver).
- ✗ Skip-to-content links en layouts.
- ✗ Focus trap en modales (¿Radix lo cubre? — confirmar).
- ✗ Live regions para updates dinámicos (saldo cambiando post-bet).

## Checklist baseline (cada PR nuevo)

Cada componente nuevo debe pasar:

- [ ] Funciona solo con teclado (Tab + Enter + Esc).
- [ ] Tiene labels semánticos (`<Label htmlFor>` o `aria-label`).
- [ ] Contraste color texto/fondo >= 4.5:1 (3:1 para text 18pt+ o bold 14pt+).
- [ ] Estados de focus visibles (no `outline: none` sin reemplazo).
- [ ] Imágenes informativas tienen `alt`. Decorativas tienen `alt=""`.
- [ ] Iconos sin texto adjacente tienen `aria-label` o `aria-hidden="true"` si decorativos.
- [ ] Errors de form se anuncian con `role="alert"` o `aria-invalid="true"`.

## Auditoría recomendada (cuando sea hora)

### Quick win: Lighthouse (Chrome DevTools)

1. Abrir `/play/lobby` en Chrome.
2. DevTools → Lighthouse → mode Mobile, accessibility checkbox.
3. Run. Reportar score (~95+ es target MVP).
4. Repetir para `/play/wheel`, `/dashboard`, `/users`.

### Auditoría formal: axe-core

Integrar `@axe-core/playwright` en los specs E2E. Cada test corre `injectAxe()`
+ `checkA11y(page)` y falla si hay violations críticas. Setup ~30min,
después automation continua.

```typescript
// Ejemplo en spec Playwright
import { injectAxe, checkA11y } from 'axe-playwright';

test('/play/lobby es accesible', async ({ page }) => {
  await page.goto('/play/lobby');
  await injectAxe(page);
  await checkA11y(page, null, {
    detailedReport: true,
    detailedReportOptions: { html: true },
  });
});
```

### Screen reader test (manual)

1. macOS: VoiceOver (Cmd+F5).
2. Windows: NVDA (free).
3. Recorrer flows críticos con ojos cerrados:
   - Login → dashboard.
   - Crear deposit.
   - Spin game.
4. Notar: ¿se anuncia el balance cambiando? ¿el toast de win se anuncia?
   ¿se puede llegar al botón Girar sin perderse en el grid del lobby?

## Hot paths críticos a auditar primero

1. **Login del player** (`/play/login`) — primer touchpoint.
2. **Lobby + GameCard** (`/play/lobby`) — navegación principal.
3. **Iframe del game** (`/play/games/[code]/play/iframe`) — el bet button
   debe ser reachable con teclado.
4. **Settings RG** (`/play/settings`) — compliance: el flow de auto-exclusión
   DEBE ser accesible para cumplir el espíritu de la regulación.
5. **Admin dashboard** — operadores con discapacidad lo usan diario.

## Anti-patterns a evitar

- `onClick` en `<div>` sin `role="button"` + `tabindex="0"` + keyboard handler.
- Custom dropdowns sin keyboard nav (use `<Select>` nativo o Radix Select).
- Modal sin focus trap (ahora cubierto por Radix Dialog).
- Colores como único discriminador (e.g. "X en rojo = mal" sin icono adicional).
- Animaciones sin `prefers-reduced-motion` respect.
