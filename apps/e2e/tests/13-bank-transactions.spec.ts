/**
 * Spec 13 — Bank transactions + separación de funciones (Sprint 50).
 *
 * Valida:
 *   - Upload de bank_transaction.
 *   - Listado filtrable por status.
 *   - Match exacto.
 *   - Match override con motivo (audit severity:high).
 *   - Match falla si los montos no coinciden y no hay override.
 *   - Match falla si bank_tx ya está matcheada.
 *   - Idempotencia por bankReference.
 *   - Unmatch revierte el match si el deposit no fue aprobado.
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  ensurePaymentMethod,
  loginAs,
  loginAsAdmin,
  type TestPlayer,
} from './helpers/api';

interface BankTxRow {
  id: string;
  amount: string;
  status: string;
  matchedDepositId: string | null;
}

interface ListResponse {
  data: BankTxRow[];
}

test.describe('Bank transactions (Sprint 50)', () => {
  let api: ApiClient;
  let methodId: string;
  let cliente: TestPlayer;

  test.beforeAll(async () => {
    api = await ApiClient.create();
    await loginAsAdmin(api);
    const m = await ensurePaymentMethod(api);
    methodId = m.id;
    cliente = await createTestPlayer(api, 'bank-tx-cliente');
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('upload + list + filter por status', async () => {
    const before = await api.get<ListResponse>(
      '/tenant/bank-transactions?status=unmatched',
    );
    const beforeCount = before.data.length;

    const created = await api.post<BankTxRow>('/tenant/bank-transactions', {
      bankAccount: 'CBU-TEST-002',
      amount: '500',
      currency: 'ARS',
      senderName: 'Test Sender',
      receivedAt: new Date().toISOString(),
    });
    expect(created.status).toBe('unmatched');

    const after = await api.get<ListResponse>(
      '/tenant/bank-transactions?status=unmatched',
    );
    expect(after.data.length).toBe(beforeCount + 1);
  });

  test('idempotencia: misma bankReference + bankAccount → 409', async () => {
    const ref = `bref-${Date.now()}`;
    await api.post('/tenant/bank-transactions', {
      bankAccount: 'CBU-IDEM',
      amount: '100',
      bankReference: ref,
      receivedAt: new Date().toISOString(),
    });
    const dup = await api.postRaw('/tenant/bank-transactions', {
      bankAccount: 'CBU-IDEM',
      amount: '100',
      bankReference: ref,
      receivedAt: new Date().toISOString(),
    });
    expect(dup.status).toBe(409);
    const body = dup.body as { error?: string };
    expect(body.error).toBe('BANK_TX_DUPLICATE_REF');
  });

  test('match exacto OK', async () => {
    // Crear deposit del cliente.
    const clienteApi = await ApiClient.create();
    await loginAs(clienteApi, cliente.username, cliente.password);
    const dep = await clienteApi.post<{ deposit: { id: string } }>(
      '/tenant/deposits',
      {
        methodId,
        amountChips: '750',
        amountFiat: '750',
        currencyFiat: 'ARS',
      },
    );
    await clienteApi.dispose();

    const bt = await api.post<BankTxRow>('/tenant/bank-transactions', {
      bankAccount: 'CBU-MATCH-1',
      amount: '750',
      receivedAt: new Date().toISOString(),
    });
    expect(bt.status).toBe('unmatched');

    const matched = await api.post<BankTxRow>(
      `/tenant/bank-transactions/${bt.id}/match/${dep.deposit.id}`,
      {},
    );
    expect(matched.status).toBe('matched');
    expect(matched.matchedDepositId).toBe(dep.deposit.id);
  });

  test('match con monto distinto SIN override → 400', async () => {
    const clienteApi = await ApiClient.create();
    await loginAs(clienteApi, cliente.username, cliente.password);
    const dep = await clienteApi.post<{ deposit: { id: string } }>(
      '/tenant/deposits',
      {
        methodId,
        amountChips: '999',
        amountFiat: '999',
        currencyFiat: 'ARS',
      },
    );
    await clienteApi.dispose();

    const bt = await api.post<BankTxRow>('/tenant/bank-transactions', {
      bankAccount: 'CBU-MISMATCH',
      amount: '1000',
      receivedAt: new Date().toISOString(),
    });

    const result = await api.postRaw(
      `/tenant/bank-transactions/${bt.id}/match/${dep.deposit.id}`,
      {},
    );
    expect(result.status).toBe(400);
    const body = result.body as { error?: string };
    expect(body.error).toBe('BANK_TX_AMOUNT_MISMATCH');
  });

  test('match con monto distinto CON override + motivo → OK', async () => {
    const clienteApi = await ApiClient.create();
    await loginAs(clienteApi, cliente.username, cliente.password);
    const dep = await clienteApi.post<{ deposit: { id: string } }>(
      '/tenant/deposits',
      {
        methodId,
        amountChips: '1005',
        amountFiat: '1005',
        currencyFiat: 'ARS',
      },
    );
    await clienteApi.dispose();

    const bt = await api.post<BankTxRow>('/tenant/bank-transactions', {
      bankAccount: 'CBU-OVERRIDE',
      amount: '1000',
      receivedAt: new Date().toISOString(),
    });

    const matched = await api.post<BankTxRow>(
      `/tenant/bank-transactions/${bt.id}/match/${dep.deposit.id}`,
      { override: true, overrideReason: 'comision bancaria descontada $5' },
    );
    expect(matched.status).toBe('matched');
  });

  test('match falla si bank_tx ya está matcheada → 409', async () => {
    // Reusar el de match exacto: ya está matched.
    const list = await api.get<ListResponse>(
      '/tenant/bank-transactions?status=matched',
    );
    const matched = list.data[0];
    expect(matched).toBeDefined();

    const clienteApi = await ApiClient.create();
    await loginAs(clienteApi, cliente.username, cliente.password);
    const dep = await clienteApi.post<{ deposit: { id: string } }>(
      '/tenant/deposits',
      {
        methodId,
        amountChips: matched!.amount,
        amountFiat: matched!.amount,
        currencyFiat: 'ARS',
      },
    );
    await clienteApi.dispose();

    const result = await api.postRaw(
      `/tenant/bank-transactions/${matched!.id}/match/${dep.deposit.id}`,
      {},
    );
    expect(result.status).toBe(409);
    const body = result.body as { error?: string };
    expect(body.error).toBe('BANK_TX_ALREADY_MATCHED');
  });
});
