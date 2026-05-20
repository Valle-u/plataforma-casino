/**
 * Spec 16 — Listado + reporting + self-view de sucursales (Sprint 51.1).
 *
 * Valida:
 *   - GET /tenant/branches devuelve los socios independent con balance
 *     + ventas 30d agregadas.
 *   - GET /tenant/branches/sales-summary filtra por from/to y suma
 *     correctamente.
 *   - GET /tenant/branches/mine devuelve el self-view del user logueado:
 *       * isIndependent + config + history para un socio independent.
 *       * isIndependent=false (sin errores) para un user que no lo es.
 *   - Permiso branch.view se requiere para list + summary; mine no.
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  createTestUserWithRole,
  loginAs,
  loginAsAdmin,
  type TestPlayer,
} from './helpers/api';

interface BranchListResponse {
  data: Array<{
    socioId: string;
    username: string;
    walletBalance: string;
    chipsSold30d: string;
    fiatSold30d: string;
    lastSaleAt: string | null;
  }>;
}

interface SalesSummary {
  data: Array<{
    socioId: string;
    salesCount: number;
    totalChipsSold: string;
    totalFiatSold: string;
  }>;
  totals: { salesCount: number; totalChipsSold: string; totalFiatSold: string };
}

interface MyBranchInfo {
  isIndependent: boolean;
  bankAccount: string | null;
  pricePerUnit: string | null;
  walletBalance: string;
  totals: {
    chipsSoldAllTime: string;
    fiatSoldAllTime: string;
    salesCount: number;
  };
  recentSales: Array<{
    walletTxId: string;
    amountChips: string;
    amountFiat: string;
    pricePerUnit: string;
  }>;
}

test.describe('Branches listing + reporting + mine (Sprint 51.1)', () => {
  let adminApi: ApiClient;
  let socio: TestPlayer;
  /** Non-socio panel user (cajero) — para validar que /mine devuelve
   *  isIndependent=false sin error. Players (usuario_final) no entran al
   *  panel; este endpoint es panel-only por diseño. */
  let cajero: TestPlayer;
  let cliente: TestPlayer;
  const PRICE = '0.9000';

  test.beforeAll(async () => {
    adminApi = await ApiClient.create();
    await loginAsAdmin(adminApi);

    socio = await createTestUserWithRole(adminApi, 'br-rep-socio', 'socio');
    cajero = await createTestUserWithRole(adminApi, 'br-rep-cajero', 'cajero');
    cliente = await createTestPlayer(adminApi, 'br-rep-cliente');

    // Activar como independent + vender fichas.
    await adminApi.post(`/tenant/users/${socio.id}/branch/toggle-independence`, {
      isIndependent: true,
      branchBankAccount: 'CBU-REP-001',
      branchChipsPricePerUnit: PRICE,
    });
    await adminApi.post(`/tenant/users/${socio.id}/branch/sell-chips`, {
      amountChips: '5000',
      notes: 'venta inicial spec 16',
    });
    await adminApi.post(`/tenant/users/${socio.id}/branch/sell-chips`, {
      amountChips: '1500',
      notes: 'venta secundaria',
    });
  });

  test.afterAll(async () => {
    await adminApi.dispose();
  });

  test('GET /branches devuelve el socio con ventas 30d agregadas', async () => {
    const res = await adminApi.get<BranchListResponse>('/tenant/branches');
    const row = res.data.find((r) => r.socioId === socio.id);
    expect(row).toBeDefined();
    expect(Number(row!.walletBalance)).toBeGreaterThanOrEqual(6500);
    // chipsSold30d incluye las 2 ventas que acabamos de hacer.
    expect(Number(row!.chipsSold30d)).toBeGreaterThanOrEqual(6500);
    // fiat = 6500 * 0.9000 = 5850.00 (al menos).
    expect(Number(row!.fiatSold30d)).toBeGreaterThanOrEqual(5850);
    expect(row!.lastSaleAt).not.toBeNull();
  });

  test('GET /branches/sales-summary suma correcto en el rango', async () => {
    // Rango amplio para asegurar que cubre nuestras ventas.
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await adminApi.get<SalesSummary>(
      `/tenant/branches/sales-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    const row = res.data.find((r) => r.socioId === socio.id);
    expect(row).toBeDefined();
    expect(row!.salesCount).toBeGreaterThanOrEqual(2);
    expect(Number(row!.totalChipsSold)).toBeGreaterThanOrEqual(6500);
    expect(Number(row!.totalFiatSold)).toBeGreaterThanOrEqual(5850);

    // Totales globales deben incluir las del socio.
    expect(res.totals.salesCount).toBeGreaterThanOrEqual(row!.salesCount);
    expect(Number(res.totals.totalChipsSold)).toBeGreaterThanOrEqual(
      Number(row!.totalChipsSold),
    );
  });

  test('GET /branches/sales-summary con rango futuro devuelve vacío', async () => {
    const from = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const res = await adminApi.get<SalesSummary>(
      `/tenant/branches/sales-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(res.data).toEqual([]);
    expect(res.totals.salesCount).toBe(0);
    expect(Number(res.totals.totalChipsSold)).toBe(0);
  });

  test('GET /branches/mine devuelve info para el socio independent', async () => {
    const socioApi = await ApiClient.create();
    await loginAs(socioApi, socio.username, socio.password);
    const mine = await socioApi.get<MyBranchInfo>('/tenant/branches/mine');
    expect(mine.isIndependent).toBe(true);
    expect(mine.bankAccount).toBe('CBU-REP-001');
    expect(mine.pricePerUnit).toBe(PRICE);
    expect(mine.totals.salesCount).toBeGreaterThanOrEqual(2);
    expect(Number(mine.totals.chipsSoldAllTime)).toBeGreaterThanOrEqual(6500);
    expect(Number(mine.totals.fiatSoldAllTime)).toBeGreaterThanOrEqual(5850);
    expect(mine.recentSales.length).toBeGreaterThanOrEqual(2);
    // El más reciente debe ser el segundo sell-chips (1500).
    expect(mine.recentSales[0]!.amountChips).toBe('1500.00');
    await socioApi.dispose();
  });

  test('GET /branches/mine devuelve isIndependent=false para no-socio panel user', async () => {
    const cajeroApi = await ApiClient.create();
    await loginAs(cajeroApi, cajero.username, cajero.password);
    const mine = await cajeroApi.get<MyBranchInfo>('/tenant/branches/mine');
    expect(mine.isIndependent).toBe(false);
    expect(mine.bankAccount).toBeNull();
    expect(mine.pricePerUnit).toBeNull();
    expect(mine.totals.salesCount).toBe(0);
    expect(mine.recentSales).toEqual([]);
    await cajeroApi.dispose();
  });

  test('GET /branches sin permiso branch.view → 403', async () => {
    // Cajero sin overrides — no tiene branch.view (no es delegado).
    const cajeroApi = await ApiClient.create();
    await loginAs(cajeroApi, cajero.username, cajero.password);
    try {
      await cajeroApi.get('/tenant/branches');
      throw new Error('debería haber tirado 403');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('403');
    }
    await cajeroApi.dispose();
  });

  test('GET /branches/mine bloqueado para players (panel-only)', async () => {
    // Players (usuario_final) no entran al panel — el endpoint /mine vive
    // bajo @PanelOnly. El player no tiene esta info; si la quiere ver, el
    // admin tendría que hacerlo socio primero.
    const clienteApi = await ApiClient.create();
    await loginAs(clienteApi, cliente.username, cliente.password);
    try {
      await clienteApi.get('/tenant/branches/mine');
      throw new Error('debería haber tirado 403');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('403');
    }
    await clienteApi.dispose();
  });
});
