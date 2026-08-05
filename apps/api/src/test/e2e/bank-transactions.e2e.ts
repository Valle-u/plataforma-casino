/**
 * E2E: BankTransactionsController — edición y borrado.
 *
 * Cubre el feature nuevo: editar/borrar transferencias AÚN sin matchear, y
 * la barrera de que una transferencia ya matcheada NO se puede editar ni
 * borrar (409 BANK_TX_ALREADY_MATCHED) — esto último también es la regresión
 * del bug donde borrar una matcheada devolvía 500 en lugar de 409.
 */

import postgres from 'postgres';
import { sql } from 'drizzle-orm';
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
  reference: string | null;
  receiptUrl: string | null;
  receiptStorageKey: string | null;
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
        reference: ref,
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

    it('409 si el comprobante choca con otra existente (dedupe por receipt_storage_key)', async () => {
      await createUnmatchedBankTx({
        bankAccount: 'DUP-ACC',
        receiptStorageKey: 'RECEIPT-DUP-A.pdf',
      });
      const second = await createUnmatchedBankTx({
        bankAccount: 'DUP-ACC',
        receiptStorageKey: 'RECEIPT-DUP-B.pdf',
      });
      const r = await ctx.request
        .patch(`/tenant/bank-transactions/${second}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ receiptStorageKey: 'RECEIPT-DUP-A.pdf' });
      expect(r.status).toBe(409);
      expect((r.body as { error: string }).error).toBe('BANK_TX_DUPLICATE_REF');
    });
  });

  /**
   * Sprint 52 (decisión dueño): las transferencias salientes requieren
   * comprobante (receipt_storage_key) — la referencia bancaria manual fue
   * eliminada. El mismo comprobante no puede cargarse dos veces (dedupe).
   */
  describe('POST /tenant/bank-transactions — comprobante obligatorio para outgoing', () => {
    it('outgoing sin comprobante → 400 BANK_TX_OUTGOING_RECEIPT_REQUIRED', async () => {
      const r = await ctx.request
        .post('/tenant/bank-transactions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          bankAccount: 'CBU-OUT-NORECEIPT',
          amount: '1500.00',
          currency: 'ARS',
          direction: 'outgoing',
          reference: 'OUT-NO-RECEIPT',
          receivedAt: new Date().toISOString(),
        });
      expect(r.status).toBe(400);
      expect((r.body as { error: string }).error).toBe(
        'BANK_TX_OUTGOING_RECEIPT_REQUIRED',
      );
    });

    it('outgoing con comprobante → 201', async () => {
      const r = await ctx.request
        .post('/tenant/bank-transactions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          bankAccount: 'CBU-OUT-RECEIPT',
          amount: '1500.00',
          currency: 'ARS',
          direction: 'outgoing',
          reference: 'OUT-RECEIPT',
          receiptUrl: 'http://localhost/proofs/out-receipt.pdf',
          receiptStorageKey: `test/proofs/out-${Date.now()}.pdf`,
          receivedAt: new Date().toISOString(),
        });
      expect(r.status).toBe(201);
    });

    it('incoming sin comprobante → 201 (el comprobante es solo para outgoing)', async () => {
      const r = await ctx.request
        .post('/tenant/bank-transactions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          bankAccount: 'CBU-IN-NORECEIPT',
          amount: '500.00',
          currency: 'ARS',
          direction: 'incoming',
          reference: 'IN-NO-RECEIPT',
          receivedAt: new Date().toISOString(),
        });
      expect(r.status).toBe(201);
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

  /**
   * Aislamiento sub-red independiente:
   * el listado del admin NO debe incluir movimientos cuya bank_account coincida
   * con el branch_bank_account de un socio marcado como independiente
   * (esos movimientos son "de su propio banco", ajenos al tenant).
   */
  describe('GET /tenant/bank-transactions — filtro cuentas de socios independientes', () => {
    const INDEP_ACCT = `CBU-INDEP-${Date.now().toString(36)}`;
    const ADMIN_ACCT = `CBU-ADMIN-${Date.now().toString(36)}`;
    let indepRef: string;
    let adminRef: string;

    beforeAll(async () => {
      const suite = `btx-indep-${Date.now().toString(36)}`;
      const socioIndep = await createTestUser(ctx.request, adminToken, {
        suite,
        label: 'socio-indep',
        role: 'socio',
      });
      await ctx.tenantDb.execute(
        sql`UPDATE users
            SET is_independent_branch = true,
                branch_bank_account = ${INDEP_ACCT}
            WHERE id = ${socioIndep.id}`,
      );

      indepRef = `INDEP-REF-${Date.now()}`;
      adminRef = `ADMIN-REF-${Date.now()}`;

      const rIndep = await ctx.request
        .post('/tenant/bank-transactions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          bankAccount: INDEP_ACCT,
          amount: '1000.00',
          currency: 'ARS',
          direction: 'incoming',
          senderName: 'debería quedar oculto',
          reference: indepRef,
          receivedAt: new Date().toISOString(),
        });
      expect(rIndep.status).toBe(201);

      const rAdmin = await ctx.request
        .post('/tenant/bank-transactions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          bankAccount: ADMIN_ACCT,
          amount: '2000.00',
          currency: 'ARS',
          direction: 'incoming',
          senderName: 'debería ser visible',
          reference: adminRef,
          receivedAt: new Date().toISOString(),
        });
      expect(rAdmin.status).toBe(201);
    });

    it('el listado del admin oculta la cuenta del socio independiente', async () => {
      const r = await ctx.request
        .get('/tenant/bank-transactions?limit=500')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.status).toBe(200);
      const data = (r.body as { data: Array<{ bankAccount: string; reference: string | null }> }).data;
      const refs = new Set(data.map((it) => it.reference));
      expect(refs.has(adminRef)).toBe(true);
      expect(refs.has(indepRef)).toBe(false);
      const accounts = new Set(data.map((it) => it.bankAccount));
      expect(accounts.has(INDEP_ACCT)).toBe(false);
    });
  });

  /**
   * D2-light — vigilancia sobre bank_tx.upload cuando el actor cuelga de
   * una sub-red independiente. Cubre:
   *   T-BT1: 21° upload en 1h de un indep → 429 (rate por count).
   *   T-BT2: primer upload que sobrepasa 100k acumulado → 429 (rate por amount).
   *   T-BT3: admin_tenant bypassea el rate-limit — 100 uploads OK.
   *   T-BT4: cada upload de un indep genera audit
   *          `bank_tx.upload_indep_self_declared` con severity y
   *          actorInIndepBranch=true.
   */
  describe('D2-light: rate-limit + audit de vigilancia sobre bank_tx.upload', () => {
    let indepToken: string;
    const INDEP_ACCT_D2 = `CBU-D2-${Date.now().toString(36)}`;

    beforeAll(async () => {
      const suite = `btx-d2-${Date.now().toString(36)}`;
      const socioIndep = await createTestUser(ctx.request, adminToken, {
        suite,
        label: 'socio-d2',
        role: 'socio',
      });

      // Marcarlo como independiente con su propia cuenta.
      await ctx.tenantDb.execute(
        sql`UPDATE users
            SET is_independent_branch = true,
                branch_bank_account = ${INDEP_ACCT_D2}
            WHERE id = ${socioIndep.id}`,
      );

      // El rol `socio` NO trae `bank_tx.upload` por default (es de
      // "empleado de confianza"). Otorgamos el override para simular el
      // caso de riesgo (el owner delegó la carga al indep).
      const grant = await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          userId: socioIndep.id,
          permissionCode: 'bank_tx.upload',
          reason: 'e2e D2-light',
        });
      expect([200, 201]).toContain(grant.status);

      indepToken = await loginAs(
        ctx.request,
        socioIndep.username,
        socioIndep.password,
        'panel',
      );
    });

    async function uploadAs(
      token: string,
      bankAccount: string,
      amount: string,
      tag: string,
    ): Promise<{ status: number; body: unknown }> {
      const ref = `D2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const res = await ctx.request
        .post('/tenant/bank-transactions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token)
        .send({
          bankAccount,
          amount,
          currency: 'ARS',
          direction: 'incoming',
          senderName: 'auto-declarado',
          reference: ref,
          receivedAt: new Date().toISOString(),
        });
      return { status: res.status, body: res.body };
    }

    it('T-BT1: el indep sube 21 bank_txs en 1h — la 21° responde 429', async () => {
      // Los 20 primeros con monto chico (evita el rate por amount: 20 x $10 = $200 << 100k).
      for (let i = 0; i < 20; i++) {
        const r = await uploadAs(indepToken, INDEP_ACCT_D2, '10.00', `c${i}`);
        expect(r.status).toBe(201);
      }
      const blocked = await uploadAs(indepToken, INDEP_ACCT_D2, '10.00', 'c-block');
      expect(blocked.status).toBe(429);
      const body = blocked.body as { error?: string; reason?: string };
      expect(body.error).toBe('BANK_TX_UPLOAD_RATE_LIMITED');
      expect(body.reason).toBe('count');
    });

    it('T-BT2: el indep sube >100k acumulado en 1h — responde 429 por amount', async () => {
      // Suite fresca — creamos otro indep para no pisar el contador del T-BT1.
      const socio2 = await createTestUser(ctx.request, adminToken, {
        suite: `btx-d2b-${Date.now().toString(36)}`,
        label: 'socio-d2b',
        role: 'socio',
      });
      const ACCT2 = `CBU-D2B-${Date.now().toString(36)}`;
      await ctx.tenantDb.execute(
        sql`UPDATE users
            SET is_independent_branch = true,
                branch_bank_account = ${ACCT2}
            WHERE id = ${socio2.id}`,
      );
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          userId: socio2.id,
          permissionCode: 'bank_tx.upload',
          reason: 'e2e D2-light amount',
        });
      const tok2 = await loginAs(
        ctx.request,
        socio2.username,
        socio2.password,
        'panel',
      );

      // 3 uploads de 40k = 120k acumulado. El 3ero proyecta $120k > $100k → 429.
      const r1 = await uploadAs(tok2, ACCT2, '40000.00', 'a1');
      expect(r1.status).toBe(201);
      const r2 = await uploadAs(tok2, ACCT2, '40000.00', 'a2');
      expect(r2.status).toBe(201);
      const r3 = await uploadAs(tok2, ACCT2, '40000.00', 'a3');
      expect(r3.status).toBe(429);
      const body = r3.body as { error?: string; reason?: string };
      expect(body.error).toBe('BANK_TX_UPLOAD_RATE_LIMITED');
      expect(body.reason).toBe('amount');
    });

    it('T-BT3: admin_tenant hace 100 uploads en 1h — no rate limit (bypass)', async () => {
      const ADMIN_ACCT_D2 = `CBU-ADMIN-D2-${Date.now().toString(36)}`;
      // 100 requests es lento — bajamos a 25, que ya supera el threshold de
      // 20 y prueba el bypass real. El comportamiento del bypass es
      // constante-tiempo (no depende del N), así que 25 vs 100 es
      // equivalente semánticamente.
      for (let i = 0; i < 25; i++) {
        const r = await uploadAs(adminToken, ADMIN_ACCT_D2, '10.00', `admin${i}`);
        expect(r.status).toBe(201);
      }
    });

    it('T-BT4: el upload de un indep produce audit `bank_tx.upload_indep_self_declared` con severity y actorInIndepBranch=true', async () => {
      // Nuevo indep — así el rate-limit del T-BT1 no interfiere.
      const socio3 = await createTestUser(ctx.request, adminToken, {
        suite: `btx-d2c-${Date.now().toString(36)}`,
        label: 'socio-d2c',
        role: 'socio',
      });
      const ACCT3 = `CBU-D2C-${Date.now().toString(36)}`;
      await ctx.tenantDb.execute(
        sql`UPDATE users
            SET is_independent_branch = true,
                branch_bank_account = ${ACCT3}
            WHERE id = ${socio3.id}`,
      );
      await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          userId: socio3.id,
          permissionCode: 'bank_tx.upload',
          reason: 'e2e D2-light audit',
        });
      const tok3 = await loginAs(
        ctx.request,
        socio3.username,
        socio3.password,
        'panel',
      );

      // Un upload por debajo del umbral high-severity → medium.
      const rMed = await uploadAs(tok3, ACCT3, '1000.00', 'audit-med');
      expect(rMed.status).toBe(201);
      const medId = (rMed.body as { id: string }).id;

      // Un upload por encima del umbral high-severity → high.
      const rHi = await uploadAs(tok3, ACCT3, '60000.00', 'audit-hi');
      expect(rHi.status).toBe(201);
      const hiId = (rHi.body as { id: string }).id;

      // Consulta al audit-log filtrando por el actionCode específico.
      const audit = await ctx.request
        .get('/tenant/audit-log?actionCode=bank_tx.upload_indep_self_declared&limit=200')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(audit.status).toBe(200);
      interface AuditEntry {
        actionCode: string;
        actorUserId: string | null;
        targetId: string | null;
        metadata: Record<string, unknown> | null;
      }
      const entries = (audit.body as { entries: AuditEntry[] }).entries;

      const medEntry = entries.find((e) => e.targetId === medId);
      const hiEntry = entries.find((e) => e.targetId === hiId);
      expect(medEntry).toBeDefined();
      expect(hiEntry).toBeDefined();

      expect(medEntry!.actionCode).toBe('bank_tx.upload_indep_self_declared');
      expect(medEntry!.actorUserId).toBe(socio3.id);
      expect(medEntry!.metadata?.actorInIndepBranch).toBe(true);
      expect(medEntry!.metadata?.severity).toBe('medium');

      expect(hiEntry!.metadata?.actorInIndepBranch).toBe(true);
      expect(hiEntry!.metadata?.severity).toBe('high');
    });
  });
});
