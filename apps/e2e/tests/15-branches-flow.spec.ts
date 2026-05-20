/**
 * Spec 15 — Sucursal independiente + sell-chips (Sprint 51).
 *
 * Valida el flujo nuevo:
 *   - Toggle de modo independiente solo aplica a socios (400 si no es socio).
 *   - Activar requiere bankAccount + price.
 *   - Sell-chips solo funciona si el socio está marcado independent.
 *   - Sell-chips mintea fichas al wallet del socio + record en wallet_tx.
 *   - El amountFiat se calcula con el precio configurado.
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  createTestUserWithRole,
  loginAsAdmin,
  type TestPlayer,
} from './helpers/api';

interface UserResponse {
  user: {
    id: string;
    isIndependentBranch: boolean;
    branchBankAccount: string | null;
    branchChipsPricePerUnit: string | null;
  };
}

interface SellChipsResponse {
  socioId: string;
  amountChips: string;
  pricePerUnit: string;
  amountFiat: string;
  walletTxId: string;
  newBalance: string;
}

test.describe('Sucursal independiente + sell-chips (Sprint 51)', () => {
  let adminApi: ApiClient;
  let socio: TestPlayer;
  let cliente: TestPlayer;

  test.beforeAll(async () => {
    adminApi = await ApiClient.create();
    await loginAsAdmin(adminApi);
    socio = await createTestUserWithRole(adminApi, 'br-socio', 'socio');
    cliente = await createTestPlayer(adminApi, 'br-cliente');
  });

  test.afterAll(async () => {
    await adminApi.dispose();
  });

  test('toggle-independence sobre user que NO es socio → 400', async () => {
    const result = await adminApi.postRaw(
      `/tenant/users/${cliente.id}/branch/toggle-independence`,
      { isIndependent: true, branchBankAccount: 'CBU-X', branchChipsPricePerUnit: '1.0000' },
    );
    expect(result.status).toBe(400);
    const body = result.body as { error?: string };
    expect(body.error).toBe('BRANCH_NOT_A_SOCIO');
  });

  test('activar sin bankAccount → 400 BRANCH_INVALID_PRICE', async () => {
    const result = await adminApi.postRaw(
      `/tenant/users/${socio.id}/branch/toggle-independence`,
      { isIndependent: true, branchChipsPricePerUnit: '1.0000' },
    );
    expect(result.status).toBe(400);
    const body = result.body as { error?: string };
    expect(body.error).toBe('BRANCH_INVALID_PRICE');
  });

  test('sell-chips antes de activar → 409 BRANCH_NOT_INDEPENDENT', async () => {
    const result = await adminApi.postRaw(
      `/tenant/users/${socio.id}/branch/sell-chips`,
      { amountChips: '100' },
    );
    expect(result.status).toBe(409);
    const body = result.body as { error?: string };
    expect(body.error).toBe('BRANCH_NOT_INDEPENDENT');
  });

  test('activar + sell-chips OK + fiat calculado con price', async () => {
    const PRICE = '0.9500'; // 5% descuento al socio
    const ACTIVATE_RESULT = await adminApi.post<UserResponse>(
      `/tenant/users/${socio.id}/branch/toggle-independence`,
      {
        isIndependent: true,
        branchBankAccount: 'CBU-SOCIO-INDEP',
        branchChipsPricePerUnit: PRICE,
      },
    );
    expect(ACTIVATE_RESULT.user.isIndependentBranch).toBe(true);
    expect(ACTIVATE_RESULT.user.branchBankAccount).toBe('CBU-SOCIO-INDEP');
    expect(ACTIVATE_RESULT.user.branchChipsPricePerUnit).toBe(PRICE);

    // Balance ANTES.
    const before = await adminApi.get<{ balance: string }>(
      `/tenant/wallet/user/${socio.id}`,
    );

    // Vender 2000 fichas → 2000 * 0.9500 = 1900.00 fiat.
    const sell = await adminApi.post<SellChipsResponse>(
      `/tenant/users/${socio.id}/branch/sell-chips`,
      { amountChips: '2000', notes: 'venta semanal' },
    );
    expect(sell.amountChips).toBe('2000');
    expect(sell.pricePerUnit).toBe(PRICE);
    expect(sell.amountFiat).toBe('1900.00');

    // Balance DESPUÉS.
    const after = await adminApi.get<{ balance: string }>(
      `/tenant/wallet/user/${socio.id}`,
    );
    expect(Number(after.balance) - Number(before.balance)).toBe(2000);
  });

  test('desactivar limpia los fields branch_*', async () => {
    const deactivated = await adminApi.post<UserResponse>(
      `/tenant/users/${socio.id}/branch/toggle-independence`,
      { isIndependent: false },
    );
    expect(deactivated.user.isIndependentBranch).toBe(false);
    expect(deactivated.user.branchBankAccount).toBeNull();
    expect(deactivated.user.branchChipsPricePerUnit).toBeNull();

    // Sell-chips ya no funciona.
    const sell = await adminApi.postRaw(
      `/tenant/users/${socio.id}/branch/sell-chips`,
      { amountChips: '100' },
    );
    expect(sell.status).toBe(409);
  });
});
