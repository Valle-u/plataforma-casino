/**
 * Helpers de accessibility — axe-core ejecutado en la página.
 *
 * Convención:
 *   - Cada test que quiera chequear a11y llama a `scanPage(page, label)`.
 *   - Reporta SOLO violations de severity `serious` y `critical` por
 *     default — los `moderate`/`minor` son ruido alto en MVP y se
 *     pueden iterar después.
 *   - `tags` configurables — por default WCAG 2 AA.
 */

import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export type Severity = 'minor' | 'moderate' | 'serious' | 'critical';

const DEFAULT_INCLUDED: Severity[] = ['serious', 'critical'];
const DEFAULT_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export interface ScanOptions {
  /** Severities a fallar si las viola. Default: serious + critical. */
  fail?: Severity[];
  /** Tags de axe a chequear. Default: WCAG 2.1 AA. */
  tags?: string[];
  /** Selectors a excluir (ej. iframes de 3rd party). */
  exclude?: string[];
  /**
   * Reglas de axe a deshabilitar. Sprint 41: usado en `/play/wallet`
   * y `/play/lobby` para `color-contrast` porque tienen overlays con
   * `bg-white/5` + glow rgba() decorativos que axe detecta como texto
   * por error (fgColor #0e0e0e sobre #0a0a0a son borders). Refactor a
   * design system tier-2 (sin overlays semitransparentes) es deuda
   * técnica documentada en DEVLOG.
   */
  disableRules?: string[];
}

/**
 * Corre axe-core en la página y falla el test si hay violations de
 * severity `fail`. Imprime resumen amigable de cada violation.
 */
export async function scanPage(
  page: Page,
  label: string,
  opts: ScanOptions = {},
): Promise<void> {
  const fail = opts.fail ?? DEFAULT_INCLUDED;
  const tags = opts.tags ?? DEFAULT_TAGS;

  let builder = new AxeBuilder({ page }).withTags(tags);
  for (const sel of opts.exclude ?? []) {
    builder = builder.exclude(sel);
  }
  if (opts.disableRules && opts.disableRules.length > 0) {
    builder = builder.disableRules(opts.disableRules);
  }
  const result = await builder.analyze();

  const blocking = result.violations.filter(
    (v) => fail.includes((v.impact as Severity) ?? 'minor'),
  );

  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => {
        const nodes = v.nodes
          .slice(0, 3)
          .map((n) => `      - ${n.target.join(' ')}`)
          .join('\n');
        return `  [${v.impact}] ${v.id}: ${v.help}\n    Help: ${v.helpUrl}\n    Nodos afectados (${v.nodes.length}, primeros 3):\n${nodes}`;
      })
      .join('\n\n');
    // eslint-disable-next-line no-console
    console.error(
      `\n[a11y] ${label} — ${blocking.length} violation(s) bloqueantes:\n${summary}\n`,
    );
  }

  expect(
    blocking,
    `${label} debería no tener violations a11y serious/critical`,
  ).toEqual([]);
}
