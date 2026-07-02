/**
 * E2E: comodín externo — permisos `*_admin_network` y bypass de ScopeGuard.
 *
 * Layout de test (mismo para todos los casos):
 *   admin_tenant
 *   ├─ D (socio dependiente)
 *   │  └─ Jd (usuario_final dependiente)
 *   ├─ I (socio independiente, is_independent_branch=true)
 *   │  └─ Ji (usuario_final bajo I)
 *   └─ E (empleado "comodín" — NO tiene descendencia; recibe overrides
 *         `*_admin_network` según cada caso)
 *
 * Comportamiento esperado:
 *   - E con `wallet.load_admin_network` → puede cargar a Jd (OK) pero
 *     NO a Ji (403 OUT_OF_SCOPE).
 *   - E con `deposits.approve_admin_network` → puede aprobar deposits
 *     de Jd, no de Ji.
 *   - E con `bonuses.grant_manual_admin_network` → puede otorgar bono
 *     a Jd, no a Ji.
 *   - E con solo `wallet.load_admin_network` (sin `wallet.load` base)
 *     pasa el gate del PermissionsGuard (alias expansion).
 *   - Regresión admin_tenant: sigue pudiendo cargar a Jd Y a Ji (su
 *     bypass jerárquico no se rompió por el nuevo bypass).
 */

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';
import { getTestTenantUrl } from '../setup/db-helpers';

interface TransferResponse {
  ok: true;
  targetWallet: { balance: string };
  sourceWallet: { balance: string };
}

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('Comodín externo — *_admin_network (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;

  // Topología del test:
  let D: TestUser; // socio dependiente
  let Jd: TestUser; // jugador bajo D (red del admin)
  let I: TestUser; // socio independiente
  let Ji: TestUser; // jugador bajo I (sub-red del independiente)
  let E: TestUser; // empleado comodín — sin descendencia
  let comodinToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    const suite = `comodin-${Date.now().toString(36)}`;

    // Crear la red del admin: D → Jd (D como hijo del admin, Jd como hijo de D).
    D = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'socioDep',
      role: 'socio',
    });
    Jd = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'playerDep',
      role: 'usuario_final',
    });
    await setParent(ctx.request, adminToken, Jd.id, D.id, 'jugador_de_cajero');

    // Sub-red independiente: I marcado como independent, Ji hijo de I.
    I = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'socioInd',
      role: 'socio',
    });
    await ctx.tenantDb.execute(
      sql`UPDATE users
          SET is_independent_branch = true,
              branch_bank_account = ${'CBU-INDEP-' + suite}
          WHERE id = ${I.id}`,
    );
    Ji = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'playerInd',
      role: 'usuario_final',
    });
    await setParent(ctx.request, adminToken, Ji.id, I.id, 'jugador_de_cajero');

    // El comodín: empleado sin descendencia. Auto-parenteado al admin
    // por createTestUser (no importa para este test — lo que importa es
    // que NO tenga descendants).
    E = await createTestUser(ctx.request, adminToken, {
      suite,
      label: 'comodin',
      role: 'empleado',
    });

    // Fondear el wallet del comodín para poder ejecutar wallet.load.
    await fundWalletForTests(E.id, '100000');

    // Login inicial del comodín (sin permisos aún).
    comodinToken = await loginAs(ctx.request, E.username, E.password);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function grantOverride(userId: string, permissionCode: string): Promise<void> {
    const r = await ctx.request
      .post('/tenant/permission-overrides/grant')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ userId, permissionCode, reason: 'e2e comodín test' });
    if (r.status !== 200 && r.status !== 201) {
      throw new Error(`grantOverride falló ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  async function relogin(): Promise<void> {
    comodinToken = await loginAs(ctx.request, E.username, E.password);
  }

  describe('wallet.load_admin_network', () => {
    beforeAll(async () => {
      await grantOverride(E.id, 'wallet.load_admin_network');
      await relogin();
    });

    it('pasa el gate @RequirePermissions(wallet.load) por alias expansion (sin wallet.load base)', async () => {
      // Prueba que el gate del PermissionsGuard reconoce el alias — si
      // fallara aquí, el request devolvería 403 MISSING_PERMISSION antes
      // de llegar al ScopeGuard.
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .set('Idempotency-Key', freshKey('c-alias-gate'))
        .send({ targetUserId: Jd.id, amount: '100.00' });
      expect(r.status).toBe(201);
    });

    it('carga a Jd (red del admin) → OK', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .set('Idempotency-Key', freshKey('c-load-jd'))
        .send({ targetUserId: Jd.id, amount: '500.00' });
      expect(r.status).toBe(201);
      const body = r.body as TransferResponse;
      expect(body.ok).toBe(true);
      // Balance de Jd sube (100 del test anterior + 500 = 600).
      expect(body.targetWallet.balance).toBe('600.00');
    });

    it('carga a Ji (sub-red del independiente) → 403 OUT_OF_SCOPE', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .set('Idempotency-Key', freshKey('c-load-ji'))
        .send({ targetUserId: Ji.id, amount: '500.00' });
      expect(r.status).toBe(403);
      expect((r.body as { error?: string }).error).toBe('OUT_OF_SCOPE');
    });

    it('regresión: admin_tenant sigue pudiendo cargar a Ji (bypass jerárquico intacto)', async () => {
      // El admin no tiene wallet fondeada por default para transfer; fondeamos.
      const me = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const adminId = (me.body as { user: { id: string } }).user.id;
      await fundWalletForTests(adminId, '10000');

      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('c-admin-load-ji'))
        .send({ targetUserId: Ji.id, amount: '100.00' });
      expect(r.status).toBe(201);
    });
  });

  describe('deposits.approve_admin_network', () => {
    let depJd: string; // deposit id de Jd
    let depJi: string; // deposit id de Ji

    beforeAll(async () => {
      await grantOverride(E.id, 'deposits.approve_admin_network');
      await relogin();

      // Crear un payment method reutilizable directo por DB (evita
      // acoplar el test al DTO de payment methods).
      const suite = `comodin-dep-${Date.now().toString(36)}`;
      const methodId = await createPaymentMethod(suite);

      // Jd crea deposit.
      const tokJd = await loginAs(ctx.request, Jd.username, Jd.password);
      const rJd = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', tokJd)
        .send({
          methodId,
          amountFiat: '5000',
          currencyFiat: 'ARS',
          amountChips: '500',
          receiptUrl: 'https://test.local/receipt.jpg',
          receiptStorageKey: 'test/receipts/jd.jpg',
        });
      expect(rJd.status).toBe(201);
      depJd = (rJd.body as { deposit: { id: string } }).deposit.id;

      // Ji crea deposit.
      const tokJi = await loginAs(ctx.request, Ji.username, Ji.password);
      const rJi = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', tokJi)
        .send({
          methodId,
          amountFiat: '5000',
          currencyFiat: 'ARS',
          amountChips: '500',
          receiptUrl: 'https://test.local/receipt.jpg',
          receiptStorageKey: 'test/receipts/ji.jpg',
        });
      expect(rJi.status).toBe(201);
      depJi = (rJi.body as { deposit: { id: string } }).deposit.id;

      // Approve requiere bank_tx matcheado. Creamos uno y matcheamos
      // solo el de Jd (el de Ji no lo matcheamos — igual el ScopeGuard
      // debe cortarlo antes de que llegue a esa validación).
      const bank = await ctx.request
        .post('/tenant/bank-transactions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          bankAccount: 'CBU-COMODIN-TEST',
          amount: '5000.00',
          currency: 'ARS',
          direction: 'incoming',
          senderName: 'Jd test sender',
          bankReference: `COMODIN-REF-${Date.now()}`,
          receivedAt: new Date().toISOString(),
        });
      expect(bank.status).toBe(201);
      const bankId = (bank.body as { id: string }).id;
      const match = await ctx.request
        .post(`/tenant/bank-transactions/${bankId}/match/${depJd}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({});
      expect(match.status).toBe(200);
    });

    it('aprueba el deposit de Jd (red del admin) → OK', async () => {
      const r = await ctx.request
        .post(`/tenant/deposits/${depJd}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .send();
      if (r.status !== 200) {
        // eslint-disable-next-line no-console
        console.log('DEP APPROVE ERR:', r.status, r.body);
      }
      expect(r.status).toBe(200);
    });

    it('rechaza aprobar el deposit de Ji (sub-red del independiente) → 403 OUT_OF_SCOPE', async () => {
      const r = await ctx.request
        .post(`/tenant/deposits/${depJi}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .send();
      expect(r.status).toBe(403);
      expect((r.body as { error?: string }).error).toBe('OUT_OF_SCOPE');
    });
  });

  describe('bonuses.grant_manual_admin_network', () => {
    let defId: string;

    beforeAll(async () => {
      await grantOverride(E.id, 'bonuses.grant_manual_admin_network');
      await relogin();

      // Fondear al admin (funder del bono) primero.
      const me = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const adminId = (me.body as { user: { id: string } }).user.id;
      await fundWalletForTests(adminId, '10000');

      // Crear una definición de bono mínima directo por DB.
      const suite = `comodin-bono-${Date.now().toString(36)}`;
      defId = await createBonusDefinition(suite, adminId);
    });

    it('otorga bono a Jd (red del admin) → OK', async () => {
      const r = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .set('Idempotency-Key', freshKey('c-bonus-jd'))
        .send({
          userId: Jd.id,
          definitionId: defId,
          amount: '200',
          reason: 'test comodin admin_network coverage',
        });
      if (![200, 201].includes(r.status)) {
        // Debug — imprime body para diagnosticar.
        // eslint-disable-next-line no-console
        console.log('BONUS GRANT ERR:', r.status, r.body);
      }
      expect([200, 201]).toContain(r.status);
    });

    it('rechaza otorgar bono a Ji → 403 OUT_OF_SCOPE', async () => {
      const r = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .set('Idempotency-Key', freshKey('c-bonus-ji'))
        .send({
          userId: Ji.id,
          definitionId: defId,
          amount: '200',
          reason: 'test comodin admin_network coverage',
        });
      expect(r.status).toBe(403);
      expect((r.body as { error?: string }).error).toBe('OUT_OF_SCOPE');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Helpers de topología
// ──────────────────────────────────────────────────────────────────────
async function setParent(
  request: TestApp['request'],
  adminToken: string,
  childId: string,
  parentUserId: string,
  relationType: string,
): Promise<void> {
  const r = await request
    .put(`/tenant/user-hierarchy/${childId}/parent`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken)
    .send({ parentUserId, relationType });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`setParent falló ${r.status} ${JSON.stringify(r.body)}`);
  }
}

async function createPaymentMethod(code: string): Promise<string> {
  const client = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await client<{ id: string }[]>`
      INSERT INTO payment_methods (id, code, name, type, config, is_active)
      VALUES (gen_random_uuid(), ${code}, ${code + ' display'}, 'bank_transfer', '{"cbu":"0000000000000000000000"}'::jsonb, true)
      RETURNING id
    `;
    return rows[0]!.id;
  } finally {
    await client.end();
  }
}

async function createBonusDefinition(code: string, fundedBy: string): Promise<string> {
  const client = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await client<{ id: string }[]>`
      INSERT INTO bonus_definitions
        (id, code, name, type, status, funded_by_user_id, created_by_user_id)
      VALUES
        (gen_random_uuid(), ${code}, ${code + ' display'}, 'manual', 'active', ${fundedBy}, ${fundedBy})
      RETURNING id
    `;
    return rows[0]!.id;
  } finally {
    await client.end();
  }
}
