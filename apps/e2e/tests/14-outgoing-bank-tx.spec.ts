/**
 * Spec 14 — Outgoing bank_tx + markPaid (Sprint 51).
 *
 * Valida la separación de funciones simétrica del Sprint 50, ahora para
 * retiros: el cajero NO puede `markPaid` sin que el empleado de confianza
 * haya cargado la transferencia bancaria SALIENTE y la haya matcheado.
 *
 * Flow:
 *   1. Player solicita un retiro → estado pending + hold sobre wallet.
 *   2. Cajero approve → estado approved.
 *   3. markPaid sin bank_tx → 400 WITHDRAWAL_REQUIRES_BANK_TX.
 *   4. Empleado sube outgoing bank_tx + matchea con withdrawal.
 *   5. Cajero markPaid OK → estado paid, wallet debitada.
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  createTestUserWithRole,
  ensurePaymentMethod,
  fundPlayer,
  loginAs,
  loginAsAdmin,
  setUserParent,
  type TestPlayer,
} from './helpers/api';

const WITHDRAWAL_AMOUNT = '300';

interface WithdrawalInfo {
  withdrawal: { id: string; status: string };
}

interface BankTxRow {
  id: string;
  amount: string;
  direction: 'incoming' | 'outgoing';
  status: string;
  matchedWithdrawalId: string | null;
}

test.describe('Outgoing bank_tx + markPaid (Sprint 51)', () => {
  let adminApi: ApiClient;
  let methodId: string;
  let cajero: TestPlayer;
  let cajeroApi: ApiClient;
  let cliente: TestPlayer;

  test.beforeAll(async () => {
    adminApi = await ApiClient.create();
    await loginAsAdmin(adminApi);
    const m = await ensurePaymentMethod(adminApi);
    methodId = m.id;

    cajero = await createTestUserWithRole(adminApi, 'wd-cajero', 'cajero');
    cliente = await createTestPlayer(adminApi, 'wd-cliente');
    await setUserParent(adminApi, cliente.id, cajero.id);

    // Permisos para el cajero: approve + process de withdrawals + match bank_tx.
    for (const perm of [
      'withdrawals.approve',
      'withdrawals.process',
      'bank_tx.view',
      'bank_tx.match',
    ]) {
      await adminApi.post('/tenant/permission-overrides/grant', {
        userId: cajero.id,
        permissionCode: perm,
        reason: 'e2e Sprint 51',
      });
    }

    // Saldo para el cliente para que pueda solicitar retiro.
    await fundPlayer(cliente.id, '1000');

    cajeroApi = await ApiClient.create();
    await loginAs(cajeroApi, cajero.username, cajero.password);
  });

  test.afterAll(async () => {
    await adminApi.dispose();
    if (cajeroApi) await cajeroApi.dispose();
  });

  test('markPaid sin outgoing bank_tx → 400 WITHDRAWAL_REQUIRES_BANK_TX', async () => {
    // 1. Cliente solicita retiro.
    const clienteApi = await ApiClient.create();
    await loginAs(clienteApi, cliente.username, cliente.password);
    const w = await clienteApi.post<WithdrawalInfo>('/tenant/withdrawals', {
      methodId,
      amountChips: WITHDRAWAL_AMOUNT,
      amountFiat: WITHDRAWAL_AMOUNT,
      currencyFiat: 'ARS',
      targetAccount: { cbu: '0000000000000000000000' },
    });
    await clienteApi.dispose();

    // 2. Cajero aprueba.
    await cajeroApi.post(`/tenant/withdrawals/${w.withdrawal.id}/approve`);

    // 3. Cajero intenta markPaid sin bank_tx → 400.
    const result = await cajeroApi.postRaw(
      `/tenant/withdrawals/${w.withdrawal.id}/mark-paid`,
      {},
    );
    expect(result.status).toBe(400);
    const body = result.body as { error?: string };
    expect(body.error).toBe('WITHDRAWAL_REQUIRES_BANK_TX');

    // El retiro sigue approved, no paid.
    const wAfter = await adminApi.get<{ withdrawal: { status: string } }>(
      `/tenant/withdrawals/${w.withdrawal.id}`,
    );
    expect(wAfter.withdrawal.status).toBe('approved');
  });

  test('flow completo: empleado sube outgoing → match → markPaid OK', async () => {
    // 1. Cliente solicita retiro.
    const clienteApi = await ApiClient.create();
    await loginAs(clienteApi, cliente.username, cliente.password);
    const w = await clienteApi.post<WithdrawalInfo>('/tenant/withdrawals', {
      methodId,
      amountChips: WITHDRAWAL_AMOUNT,
      amountFiat: WITHDRAWAL_AMOUNT,
      currencyFiat: 'ARS',
      targetAccount: { cbu: '1111111111111111111111' },
    });
    await clienteApi.dispose();

    // 2. Cajero aprueba.
    await cajeroApi.post(`/tenant/withdrawals/${w.withdrawal.id}/approve`);

    // 3. Empleado (admin en este test) sube outgoing bank_tx.
    //    Sprint 52: comprobante obligatorio para outgoing.
    const outgoingBt = await adminApi.post<BankTxRow>('/tenant/bank-transactions', {
      bankAccount: 'CBU-TENANT-001',
      amount: WITHDRAWAL_AMOUNT,
      currency: 'ARS',
      direction: 'outgoing',
      senderName: 'Cliente Test (destinatario)',
      receiptUrl: `http://localhost/proofs/e2e-14-${Date.now()}.pdf`,
      receiptStorageKey: `test/proofs/e2e-14-${Date.now()}.pdf`,
      receivedAt: new Date().toISOString(),
      notes: 'e2e outgoing wd',
    });
    expect(outgoingBt.direction).toBe('outgoing');
    expect(outgoingBt.status).toBe('unmatched');

    // 4. Cajero matchea outgoing bank_tx con el withdrawal.
    const matched = await cajeroApi.post<BankTxRow>(
      `/tenant/bank-transactions/${outgoingBt.id}/match-withdrawal/${w.withdrawal.id}`,
      {},
    );
    expect(matched.status).toBe('matched');
    expect(matched.matchedWithdrawalId).toBe(w.withdrawal.id);

    // 5. Cajero markPaid → OK.
    const paid = await cajeroApi.post<{ withdrawal: { status: string } }>(
      `/tenant/withdrawals/${w.withdrawal.id}/mark-paid`,
      {},
    );
    expect(paid.withdrawal.status).toBe('paid');
  });

  test('listado filtrable por direction', async () => {
    // Aseguramos que el filtro server-side de direction funciona.
    const outgoing = await adminApi.get<{ data: BankTxRow[] }>(
      '/tenant/bank-transactions?direction=outgoing&limit=200',
    );
    expect(outgoing.data.length).toBeGreaterThan(0);
    for (const bt of outgoing.data) {
      expect(bt.direction).toBe('outgoing');
    }

    const incoming = await adminApi.get<{ data: BankTxRow[] }>(
      '/tenant/bank-transactions?direction=incoming&limit=200',
    );
    for (const bt of incoming.data) {
      expect(bt.direction).toBe('incoming');
    }
  });

  test('unmatched-for-amount filtra por direction', async () => {
    // Subimos un outgoing nuevo con monto único + un incoming con mismo monto
    // para verificar que el filter direction no los confunde.
    const uniqueAmount = String(1000 + Math.floor(Math.random() * 100000));
    await adminApi.post('/tenant/bank-transactions', {
      bankAccount: 'CBU-FILTER-OUT',
      amount: uniqueAmount,
      direction: 'outgoing',
      receivedAt: new Date().toISOString(),
    });
    await adminApi.post('/tenant/bank-transactions', {
      bankAccount: 'CBU-FILTER-IN',
      amount: uniqueAmount,
      direction: 'incoming',
      receivedAt: new Date().toISOString(),
    });

    const out = await cajeroApi.get<{ data: BankTxRow[] }>(
      `/tenant/bank-transactions/unmatched-for-amount/${uniqueAmount}?direction=outgoing`,
    );
    expect(out.data.length).toBe(1);
    expect(out.data[0]!.direction).toBe('outgoing');

    const inc = await cajeroApi.get<{ data: BankTxRow[] }>(
      `/tenant/bank-transactions/unmatched-for-amount/${uniqueAmount}?direction=incoming`,
    );
    expect(inc.data.length).toBe(1);
    expect(inc.data[0]!.direction).toBe('incoming');
  });
});
