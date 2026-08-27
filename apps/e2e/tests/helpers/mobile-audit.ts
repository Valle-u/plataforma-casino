/**
 * Auditor de UI mobile — mide overflow horizontal y tap targets chicos.
 *
 * Por qué existe: las mediciones a mano subestimaban. Una página solo
 * renderiza la pestaña/sección abierta, así que auditar la vista inicial
 * deja afuera el resto. En `/settings` eso significaba ver 19 targets
 * cuando en realidad hay ~130 repartidos en 10 secciones.
 *
 * Este helper resuelve tres cosas que la medición ingenua hacía mal:
 *
 *   1. RECORRE ESTADOS. Descubre los conmutadores (tabs, rails, filtros) y
 *      los clickea uno por uno, midiendo en cada estado.
 *   2. NO CLICKEA LO QUE NO DEBE. La primera versión a mano agarró el
 *      sidebar oculto y terminó apretando "Cerrar sesión". Acá se exige
 *      visibilidad real, se excluyen submits y verbos de acción, y se
 *      descarta cualquier click que cambie de ruta.
 *   3. MIDE EL ÁREA EFECTIVA, no la caja del elemento. Un control puede
 *      verse chico y ser tocable: un `::after` absoluto con insets
 *      negativos (la técnica de los indicadores del banner) o un `<label>`
 *      envolvente que al clickearlo enfoca el input (el buscador de
 *      Ajustes: input de 42px dentro de un label de 44).
 */

import type { Page } from '@playwright/test';

/** Mínimo táctil de Apple HIG. WCAG 2.2 AA pide 24; el objetivo acá es 44. */
export const MIN_TAP = 44;

export interface SmallTarget {
  sel: string;
  text: string;
  w: number;
  h: number;
}

export interface StateAudit {
  /** Nombre del estado: 'inicial' o el label del conmutador clickeado. */
  state: string;
  overflow: boolean;
  scrollW: number;
  viewportW: number;
  targets: SmallTarget[];
}

export interface RouteAudit {
  route: string;
  states: StateAudit[];
  /** Targets únicos (dedupe por selector+texto+tamaño) de todos los estados. */
  unique: SmallTarget[];
  /** True si CUALQUIER estado desborda horizontalmente. */
  overflow: boolean;
  /** Conmutadores detectados en la ruta. */
  switchersFound: number;
  /**
   * Conmutadores que NO se pudieron visitar (tapados, desaparecidos, o que
   * navegaban). Se reporta explícitamente: un auditor que no dice qué se
   * perdió da falsos "0 targets" — que es justo el bug que tenía.
   */
  switchersMissed: string[];
  error?: string;
}

/**
 * Verbos que no se clickean nunca durante la auditoría: mutan datos, navegan
 * o cierran la sesión. La auditoría es de solo lectura.
 */
const VERBOS_PELIGROSOS =
  /cerrar sesi|salir|elimin|borr|guardar|enviar|crear|aprob|rechaz|pagar|confirm|activar|desactivar|impersonar|bloquear|resetear|sincroniz|fondear|mintear|quemar|liquidar|settle|subir|cargar nueva|reintentar|limpiar/i;

/**
 * Botones que abren overlays y bloquean todo lo que venga después: el
 * buscador global (⌘K), el chip de saldo, avisos. La primera versión los
 * clickeaba y a partir de ahí TODOS los clicks fallaban contra el backdrop
 * — por eso cada ruta reportaba siempre 3 estados y `/settings` daba 0
 * targets teniendo ~130.
 */
const ABREN_OVERLAY = /^buscar|⌘k|^avisos?$|^\d[\d.,]*$/i;

/** Cierra modales/popovers abiertos. Hasta 3 intentos: puede haber anidados. */
async function cerrarOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const abierto = await page
      .locator('[role=dialog]:visible, [data-state=open][role=menu]:visible')
      .count();
    if (abierto === 0) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
  }
}

/**
 * Mide, dentro de la página, el estado actual: overflow + targets chicos.
 * Todo el cálculo va en el browser porque necesita geometría y estilos.
 */
async function medirEstado(page: Page, state: string): Promise<StateAudit> {
  return page.evaluate(
    ({ estado, minTap }) => {
      const root = document.documentElement;
      const vw = root.clientWidth;

      const clases = (el: Element): string =>
        String(el.getAttribute('class') || '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .join('.');

      const num = (v: string): number => {
        const n = Number.parseFloat(v);
        return Number.isFinite(n) ? n : Number.NaN;
      };

      /**
       * Área realmente tocable: la caja del elemento, expandida por
       * pseudo-elementos absolutos (patrón de hit-area invisible) y por un
       * `<label>` envolvente que delegue el foco a este único control.
       */
      const areaEfectiva = (el: Element): { w: number; h: number } => {
        const r = el.getBoundingClientRect();
        let { left, top, right, bottom } = r;

        for (const pseudo of ['::after', '::before']) {
          const cs = getComputedStyle(el, pseudo);
          if (cs.content === 'none' || cs.position !== 'absolute') continue;
          const l = num(cs.left);
          const t = num(cs.top);
          const w = num(cs.width);
          const h = num(cs.height);
          if (![l, t, w, h].every(Number.isFinite)) continue;
          left = Math.min(left, r.left + l);
          top = Math.min(top, r.top + t);
          right = Math.max(right, r.left + l + w);
          bottom = Math.max(bottom, r.top + t + h);
        }

        const label = el.closest('label');
        if (label) {
          const controles = label.querySelectorAll(
            'input:not([type=hidden]), select, textarea, button, a[href]',
          );
          if (controles.length === 1) {
            const lr = label.getBoundingClientRect();
            left = Math.min(left, lr.left);
            top = Math.min(top, lr.top);
            right = Math.max(right, lr.right);
            bottom = Math.max(bottom, lr.bottom);
          }
        }

        return { w: right - left, h: bottom - top };
      };

      const SEL =
        'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch]';
      const vistos = new Set<string>();
      const targets: { sel: string; text: string; w: number; h: number }[] = [];

      for (const el of Array.from(document.querySelectorAll(SEL))) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
        if ((el as HTMLElement).offsetParent === null && cs.position !== 'fixed') continue;

        const { w, h } = areaEfectiva(el);
        // 0.5 de tolerancia: los anchos fraccionarios dan 43.98 y no son un bug.
        if (w >= minTap - 0.5 && h >= minTap - 0.5) continue;

        const sel = el.tagName.toLowerCase() + (clases(el) ? '.' + clases(el) : '');
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 32);
        const clave = `${sel}|${text}|${Math.round(w)}x${Math.round(h)}`;
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        targets.push({ sel, text, w: Math.round(w), h: Math.round(h) });
      }

      return {
        state: estado,
        overflow: root.scrollWidth > vw + 1,
        scrollW: root.scrollWidth,
        viewportW: vw,
        targets,
      };
    },
    { estado: state, minTap: MIN_TAP },
  );
}

/**
 * Descubre conmutadores de estado seguros: botones visibles que pertenecen a
 * un grupo de hermanos (forma de tira de tabs) o tienen `role=tab`, sin
 * verbos de acción y sin `type=submit`.
 *
 * Devuelve los labels; el caller los vuelve a resolver por texto antes de
 * clickear, porque el DOM se re-renderiza entre estados.
 */
async function descubrirConmutadores(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ patronPeligroso, patronOverlay }) => {
      const peligroso = new RegExp(patronPeligroso, 'i');
      const overlay = new RegExp(patronOverlay, 'i');
      const candidatos: string[] = [];
      const vistos = new Set<string>();

      for (const btn of Array.from(document.querySelectorAll('button'))) {
        if (btn.offsetParent === null) continue; // invisible → nunca se clickea
        if (btn.getAttribute('type') === 'submit') continue;
        if (btn.disabled) continue;

        const texto = (btn.textContent || '').trim().replace(/\s+/g, ' ');
        if (!texto || texto.length > 34) continue;
        if (peligroso.test(texto)) continue;
        if (overlay.test(texto)) continue;

        const esTab = btn.getAttribute('role') === 'tab';
        const padre = btn.parentElement;
        const hermanos = padre
          ? Array.from(padre.children).filter((c) => c.tagName === 'BUTTON').length
          : 0;
        // Forma de tira de tabs: 2+ botones hermanos. O un role=tab explícito.
        if (!esTab && hermanos < 2) continue;

        if (vistos.has(texto)) continue;
        vistos.add(texto);
        candidatos.push(texto);
      }
      return candidatos;
    },
    { patronPeligroso: VERBOS_PELIGROSOS.source, patronOverlay: ABREN_OVERLAY.source },
  );
}

/**
 * Audita una ruta completa: estado inicial + cada conmutador descubierto.
 *
 * Si un click cambia de ruta, se descarta ese estado y se vuelve — significa
 * que el heurístico confundió un link disfrazado de botón con una tab.
 */
export async function auditarRuta(page: Page, ruta: string): Promise<RouteAudit> {
  const states: StateAudit[] = [];
  try {
    await page.goto(ruta, { waitUntil: 'networkidle', timeout: 30_000 });
  } catch {
    // networkidle puede no llegar nunca con polling; el DOM ya sirve.
  }
  await page.waitForTimeout(1200);

  const rutaReal = new URL(page.url()).pathname;
  states.push(await medirEstado(page, 'inicial'));

  const conmutadores = await descubrirConmutadores(page);
  const alcanzados: string[] = [];
  for (const label of conmutadores) {
    try {
      // Un overlay que quedó abierto tapa TODO lo que sigue. Se cierra antes
      // y después de cada click.
      await cerrarOverlays(page);
      // Match exacto: `hasText` es substring y `.first()` terminaba
      // agarrando otro botón (ej. "Apariencia" vs "Apariencia del panel").
      const btn = page.getByRole('button', { name: label, exact: true }).first();
      if (!(await btn.isVisible({ timeout: 800 }))) continue;
      await btn.click({ timeout: 3000 });
      await page.waitForTimeout(900);
      if (new URL(page.url()).pathname !== rutaReal) {
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(900);
        continue;
      }
      await cerrarOverlays(page);
      states.push(await medirEstado(page, label));
      alcanzados.push(label);
    } catch {
      // Botón que desapareció tras un re-render, o tapado por un overlay.
      continue;
    }
  }

  const vistos = new Set<string>();
  const unique: SmallTarget[] = [];
  for (const s of states) {
    for (const t of s.targets) {
      const clave = `${t.sel}|${t.text}|${t.w}x${t.h}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      unique.push(t);
    }
  }

  return {
    route: ruta,
    states,
    unique,
    overflow: states.some((s) => s.overflow),
    switchersFound: conmutadores.length,
    switchersMissed: conmutadores.filter((c) => !alcanzados.includes(c)),
  };
}

/** Reporte de texto plano, ordenado por gravedad. */
export function formatearReporte(titulo: string, rutas: RouteAudit[]): string {
  const lineas: string[] = ['', `═══ ${titulo} ═══`, ''];
  const conOverflow = rutas.filter((r) => r.overflow);
  const totalTargets = rutas.reduce((s, r) => s + r.unique.length, 0);

  lineas.push(`Rutas auditadas: ${rutas.length}`);
  lineas.push(`Tap targets < ${MIN_TAP}px (únicos): ${totalTargets}`);
  lineas.push(
    `Rutas con overflow horizontal: ${conOverflow.length}${
      conOverflow.length ? ' → ' + conOverflow.map((r) => r.route).join(', ') : ''
    }`,
  );
  lineas.push('');

  for (const r of [...rutas].sort((a, b) => b.unique.length - a.unique.length)) {
    if (r.error) {
      lineas.push(`  ✖ ${r.route} — ${r.error}`);
      continue;
    }
    const estados = r.states.length;
    const marca = r.overflow ? ' [OVERFLOW]' : '';
    // Un "0 targets" con conmutadores no visitados NO es una ruta limpia.
    const limpia = r.unique.length === 0 && r.switchersMissed.length === 0;
    lineas.push(
      `  ${limpia ? '✓' : '·'} ${r.route}${marca} — ${r.unique.length} targets · ${estados}/${r.switchersFound + 1} estado(s)`,
    );
    const desbordan = r.states.filter((s) => s.overflow);
    if (desbordan.length) {
      lineas.push(
        `      ⇥ desborda en: ${desbordan
          .map((s) => `${s.state} (${s.scrollW}px vs ${s.viewportW})`)
          .join(', ')}`,
      );
    }
    if (r.switchersMissed.length) {
      lineas.push(
        `      ⚠ sin visitar (${r.switchersMissed.length}): ${r.switchersMissed.slice(0, 5).join(', ')}`,
      );
    }
    for (const t of r.unique.slice(0, 6)) {
      lineas.push(`      ${t.w}x${t.h}  ${t.sel} «${t.text}»`);
    }
    if (r.unique.length > 6) lineas.push(`      … y ${r.unique.length - 6} más`);
  }
  lineas.push('');
  return lineas.join('\n');
}
