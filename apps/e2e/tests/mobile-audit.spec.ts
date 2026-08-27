/**
 * Auditoría de UI mobile — panel + sitio del jugador a 375x812.
 *
 * NO es un test de pass/fail: es un reporte. Por eso queda fuera de la suite
 * normal (`testIgnore` en playwright.config.ts) y se corre aparte:
 *
 *     pnpm --filter @casino/e2e audit:mobile
 *
 * Requiere api (3000) + web (3001) arriba, igual que el resto de los specs.
 *
 * Falla solo ante un desborde horizontal, que sí es un bug objetivo: en
 * mobile la página se va de ancho y el usuario scrollea de costado. Los tap
 * targets se reportan pero no rompen — hay decisiones deliberadas (ej.
 * `Button size="sm"` a 36px en contextos densos) que no son defectos.
 */

import { expect, test } from '@playwright/test';
import { loginAdminViaUi, loginPlayerViaUi } from './helpers/auth';
import { ApiClient, createTestPlayer, loginAsAdmin } from './helpers/api';
import { auditarRuta, formatearReporte, type RouteAudit } from './helpers/mobile-audit';

const MOBILE = { width: 375, height: 812 };

const RUTAS_PANEL = [
  '/dashboard',
  '/users',
  '/deposits',
  '/withdrawals',
  '/bank-transactions',
  '/branches',
  '/red',
  '/network-commissions',
  '/tesoreria',
  '/wallet-stats',
  '/game-stats',
  '/games',
  '/integrity',
  '/audit',
  '/promotions',
  '/bonus-definitions',
  '/bonuses',
  '/referrals',
  '/leagues',
  '/payment-methods',
  '/settings',
  '/wallet',
  '/my-branch',
];

const RUTAS_JUGADOR = [
  '/play',
  '/play/lobby',
  '/play/account',
  '/play/deposits',
  '/play/withdrawals',
  '/play/bonuses',
  '/play/notifications',
  '/play/achievements',
  '/play/streak',
  '/play/wheel',
];

/**
 * `AUDIT_ROUTES=settings,games` limita el barrido — sirve para iterar sobre
 * una ruta puntual sin esperar los ~9 min del panel completo.
 *
 * Matchea por substring a propósito: en Git Bash un valor que arranca con `/`
 * lo reescribe MSYS a una ruta de Windows y el filtro no pegaba nunca.
 */
function filtrar(rutas: string[]): string[] {
  const filtro = process.env.AUDIT_ROUTES;
  if (!filtro) return rutas;
  const pedidas = filtro
    .split(',')
    .map((r) => r.trim().replace(/^\/+/, ''))
    .filter(Boolean);
  return rutas.filter((r) => pedidas.some((p) => r.replace(/^\/+/, '') === p));
}

test.describe('Auditoría mobile', () => {
  test.describe.configure({ mode: 'serial', timeout: 15 * 60_000 });

  test('panel (admin)', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await loginAdminViaUi(page);

    const rutas: RouteAudit[] = [];
    for (const ruta of filtrar(RUTAS_PANEL)) {
      rutas.push(await auditarRuta(page, ruta));
    }

    console.log(formatearReporte('PANEL — 375x812', rutas));

    const conOverflow = rutas.filter((r) => r.overflow).map((r) => r.route);
    expect(conOverflow, `Rutas del panel con overflow horizontal: ${conOverflow.join(', ')}`).toEqual([]);
  });

  test('sitio del jugador', async ({ page }) => {
    await page.setViewportSize(MOBILE);

    // El jugador se crea por API: los specs no comparten fixtures.
    const api = await ApiClient.create();
    await loginAsAdmin(api);
    const jugador = await createTestPlayer(api, 'mobaudit');
    await api.dispose();
    await loginPlayerViaUi(page, jugador.username, jugador.password);

    const rutas: RouteAudit[] = [];
    for (const ruta of filtrar(RUTAS_JUGADOR)) {
      rutas.push(await auditarRuta(page, ruta));
    }

    console.log(formatearReporte('JUGADOR — 375x812', rutas));

    const conOverflow = rutas.filter((r) => r.overflow).map((r) => r.route);
    expect(conOverflow, `Rutas del jugador con overflow horizontal: ${conOverflow.join(', ')}`).toEqual([]);
  });
});
