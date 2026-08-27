/**
 * Config para la auditoría de UI mobile (`pnpm audit:mobile`).
 *
 * Existe aparte porque `mobile-audit.spec.ts` está en el `testIgnore` del
 * config principal: es un reporte, no un test de la suite, y tarda minutos.
 * Se resolvió con un segundo config en vez de una env var para no sumar
 * `cross-env` como dependencia solo por esto.
 *
 * Sin retries: un reporte no se reintenta, se lee.
 */

import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: ['**/mobile-audit.spec.ts'],
  retries: 0,
  reporter: [['list']],
});
