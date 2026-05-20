/**
 * Playwright config — E2E browser-based del casino.
 *
 * Asunciones de runtime (correr `pnpm e2e` requiere ambos arriba):
 *   - Backend API en http://localhost:3000 (apps/api con `pnpm dev`).
 *   - Web en http://localhost:3001 (apps/web con `pnpm dev`).
 *   - Postgres + dev tenant seedeado (`pnpm --filter @casino/db db:seed:dev-tenant`).
 *
 * Tenant target = `demo.localhost`. El web envía `X-Tenant-Host: demo.localhost`
 * en cada fetch (lo lee el TenantResolverMiddleware). NO necesitás editar
 * /etc/hosts — el envvar `NEXT_PUBLIC_TENANT_HOST` lo controla.
 *
 * Specs aislados: cada spec crea su propio user via API (no comparten
 * fixtures). Cleanup es opcional — el test tenant se limpia con
 * re-seed cuando hace falta.
 *
 * CI: hoy NO está enchufado. Si emerge necesidad, agregar workflow
 * GitHub Actions que levante api + web + DB con docker-compose y
 * corra `pnpm --filter @casino/e2e test`.
 */

import { defineConfig, devices } from '@playwright/test';

// Sprint 44: `127.0.0.1` para forzar IPv4 (ver comment en helpers/api.ts).
const WEB_BASE = process.env.E2E_WEB_BASE_URL ?? 'http://127.0.0.1:3001';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // los specs comparten DB del tenant; serializo para evitar races.
  forbidOnly: !!process.env.CI,
  // Sprint 44: 1 retry en local también. Los specs comparten DB del
  // tenant `demo` y acumulan state cross-spec (no es aislamiento
  // perfecto — cada spec crea sus users, pero datos de wallet, payment
  // methods, etc. quedan). Aislados pasan 100%; en full-run hay race
  // ocasional. Refactor a tenant-por-spec sería caro; mientras tanto,
  // 1 retry compensa los flakes legítimos sin ocultar bugs reales.
  retries: process.env.CI ? 2 : 1,
  workers: 1, // un solo worker — DB compartida.
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: WEB_BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    /**
     * `extraHTTPHeaders` aplica también a los fetch del browser (NO solo a
     * los manuales con `request`). El header `X-Tenant-Host` lo lee el
     * api-client del web — pero el web ya lo setea desde localStorage o
     * env. Para los api helpers de los tests, lo pasamos explícito.
     */
    extraHTTPHeaders: {
      'X-Tenant-Host': process.env.E2E_TENANT_HOST ?? 'demo.localhost',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
