/**
 * E2E: BankTransactionsController — edición y borrado.
 *
 * Cubre el feature nuevo: editar/borrar transferencias AÚN sin matchear, y
 * la barrera de que una transferencia ya matcheada NO se puede editar ni
 * borrar (409 BANK_TX_ALREADY_MATCHED) — esto último también es la regresión
 * del bug donde borrar una matcheada devolvía 500 en lugar de 409.
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';

const FAKE_UUID = '019e0000-0000-7000-8000-000000000000';

interface BankTxBody {
  id: string;
  amount: string;
  senderName: string | null;
  bankReference: string | null;
  notes: string | null;
  status: string;
}

/** Crea un payment method de test directamente en DB (igual que deposits.e2e). */
async function createPaymentMethod(code: string): Promise<string> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO payment_methods (id, code, name, type, config, is_active)
      VALUES (gen_random_uuid(), ${code}, ${code + ' display'}, 'bank_transfer', '{"cbu":"0000000000000000000000"}'::jsonb, true)
      RETURNING id
    `;
    return rows[0]!.id;
  } finally {
    await sql.end();
  }
}

describe('BankTransactionsController — edit/delete (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let seq = 0;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function createUnmatchedBankTx(
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const ref = `EDIT-${Date.now()}-${(seq += 1)}`;
    const r = await ctx.request
      .post('/tenant/bank-transactions')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        bankAccount: 'CBU-TEST-1',
        amount: '1000.00',
        currency: 'ARS',
        direction: 'incoming',
        senderName: 'Remitente Original',
        bankReference: ref,
        receivedAt: new Date().toISOString(),
        ...overrides,
      });
    expect(r.status).toBe(201);
    return (r.body as { id: string }).id;
  }

  describe('PATCH /tenant/bank-transactions/:id', () => {
    it('edita una transferencia sin matchear', async () => {
      const id = await createUnmatchedBankTx();
      const r = await ctx.request
        .patch(`/tenant/bank-transactions/${id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ amount: '2500.50', senderName: 'Corregido', notes: 'ajuste monto' });

      expect(r.status).toBe(200);
      const body = r.body as BankTxBody;
      expect(body.amount).toBe('2500.50');
      expect(body.senderName).toBe('Corregido');
      expect(body.notes).toBe('ajuste monto');
      expect(body.status).toBe('unmatched');
    });

    it('vacía un campo de texto mandando string vacío', async () => {
      const id = await createUnmatchedBankTx();
      const r = await ctx.request
        .patch(`/tenant/bank-transactions/${id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ senderName: '' });
      expect(r.status).toBe(200);
      expect((r.body as BankTxBody).senderName).toBeNull();
    });

    it('404 si la transferencia no existe', async () => {
      const r = await ctx.request
        .patch(`/tenant/bank-transactions/${FAKE_UUID}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ notes: 'x' });
      expect(r.status).toBe(404);
    });

    it('409 si la referencia bancaria choca con otra existente', async () => {
      await createUnmatchedBankTx({ bankAccount: 'DUP-ACC', bankReference: 'DUP-REF-A' });
      const second = await createUnmatchedBankTx({ bankAccount: 'DUP-ACC', bankReference: 'DUP-REF-B' });
      const r = await ctx.request
        .patch(`/tenant/bank-transactions/${second}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ bankReference: 'DUP-REF-A' });
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('BANK_TX_DUPLICATE_REF');
    });
  });

  describe('DELETE /tenant/bank-transactions/:id', () => {
    it('borra una transferencia sin matchear (204)', async () => {
      const id = await createUnmatchedBankTx();
      const r = await ctx.request
        .delete(`/tenant/bank-transactions/${id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(204);

      const after = await ctx.request
        .get(`/tenant/bank-transactions/${id}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(after.status).toBe(404);
    });

    it('404 si la transferencia no existe', async () => {
      const r = await ctx.request
        .delete(`/tenant/bank-transactions/${FAKE_UUID}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(404);
    });
  });

  describe('matcheada → no editable ni borrable (409)', () => {
    let matchedId: string;

    beforeAll(async () => {
      // Armamos un deposit y lo matcheamos con una bank_tx de igual monto.
      const methodId = await createPaymentMethod(
        `btx-method-${Date.now().toString(36)}`,
      );
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'btx-matched',
        label: 'p',
        role: 'cajero',
      });
      const token = await loginAs(ctx.request, player.username, player.password);

      const dep = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token)
        .send({
          methodId,
          amountFiat: '5000',
          currencyFiat: 'ARS',
          amountChips: '500',
          receiptUrl: 'https://test.local/receipt.jpg',
          receiptStorageKey: 'test/receipts/proof.jpg',
        });
      expect(dep.status).toBe(201);
      const depositId = (dep.body as { deposit: { id: string } }).deposit.id;

      matchedId = await createUnmatchedBankTx({ amount: '5000.00' });
      const m = await ctx.request
        .post(`/tenant/bank-transactions/${matchedId}/match/${depositId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({});
      expect(m.status).toBe(200);
    });

    it('PATCH sobre una matcheada → 409 BANK_TX_ALREADY_MATCHED', async () => {
      const r = await ctx.request
        .patch(`/tenant/bank-transactions/${matchedId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ notes: 'no debería poder' });
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('BANK_TX_ALREADY_MATCHED');
    });

    it('DELETE sobre una matcheada → 409 (antes daba 500)', async () => {
      const r = await ctx.request
        .delete(`/tenant/bank-transactions/${matchedId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('BANK_TX_ALREADY_MATCHED');
    });
  });
});
