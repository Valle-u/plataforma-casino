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

  describe('wallet.correct_admin_network', () => {
    // F4: el ScopeGuard debe cortar wallet.correct por sub-red indep, y el
    // bypass @AdminNetworkBypass('wallet.correct_admin_network') debe abrir
    // solo la red del admin (nunca sub-redes indep).
    //
    // Notas de setup:
    //   - El empleado necesita `wallet.correct` (base) para pasar el gate del
    //     PermissionsGuard en T-C1. Los casos T-C2/T-C3 dependen del alias
    //     (que expande al base vía expandAdminNetworkAliases).
    //   - El cupo mensual se fija por endpoint (E), o por SQL directo para
    //     admin_tenant (setCap endpoint exige rol 'empleado').
    //   - La Casa se fondea por SQL para tener saldo del que drenar.
    let adminId: string;

    async function fundHouse(): Promise<void> {
      await ctx.tenantDb.execute(
        sql`UPDATE wallets SET balance = '1000000'
            WHERE user_id = (SELECT id FROM users WHERE username = '__casa__')`,
      );
    }

    async function setCapDirect(userId: string, cap: string): Promise<void> {
      await ctx.tenantDb.execute(
        sql`UPDATE users SET employee_correction_cap_monthly = ${cap}
            WHERE id = ${userId}`,
      );
    }

    async function clearOverride(userId: string, permissionCode: string): Promise<void> {
      const r = await ctx.request
        .post('/tenant/permission-overrides/clear')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId, permissionCode });
      if (r.status !== 200 && r.status !== 201) {
        throw new Error(`clearOverride falló ${r.status} ${JSON.stringify(r.body)}`);
      }
    }

    beforeAll(async () => {
      // Fondear la Casa: es de donde salen las fichas de la corrección.
      await fundHouse();

      // Cupo mensual para E (empleado) — por endpoint (E tiene rol empleado).
      await ctx.request
        .patch(`/tenant/correction/user/${E.id}/cap`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ cap: '100000' })
        .expect(200);

      // Cupo para admin_tenant — por SQL, el endpoint exige rol 'empleado'.
      const me = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      adminId = (me.body as { user: { id: string } }).user.id;
      await setCapDirect(adminId, '100000');

      // Base permission wallet.correct para E — sin ella el gate del
      // PermissionsGuard cortaría antes del ScopeGuard en T-C1 (queremos
      // probar el ScopeGuard, no el gate). En T-C2/T-C3 sumamos el alias.
      await grantOverride(E.id, 'wallet.correct');
      await relogin();
    });

    it('T-C1: SIN comodín, correct a Ji (sub-red indep) → 403 OUT_OF_SCOPE', async () => {
      // E tiene wallet.correct base + cupo, pero NO wallet.correct_admin_network.
      // Ji no es descendiente de E ⇒ ScopeGuard debe cortar.
      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .send({
          targetUserId: Ji.id,
          amount: '100.00',
          reasonType: 'correction',
          reasonNotes: 'T-C1: sin comodín, sub-red indep debe cortar',
        });
      expect(r.status).toBe(403);
      expect((r.body as { error?: string }).error).toBe('OUT_OF_SCOPE');
    });

    it('T-C2: CON comodín, correct a Jd (red del admin) → 201', async () => {
      // Sumamos el alias — expandAdminNetworkAliases mantiene wallet.correct
      // base activo, y el @AdminNetworkBypass abre Jd (red del admin).
      await grantOverride(E.id, 'wallet.correct_admin_network');
      await relogin();

      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .send({
          targetUserId: Jd.id,
          amount: '100.00',
          reasonType: 'bonus',
          reasonNotes: 'T-C2: con comodín, Jd de la red del admin',
        });
      expect(r.status).toBe(201);
    });

    it('T-C3: CON comodín, correct a Ji (sub-red indep) → 403 OUT_OF_SCOPE', async () => {
      // El comodín *_admin_network NO abre sub-redes indep (misma simetría
      // que wallet.load_admin_network). I quedó marcado is_independent_branch
      // ⇒ getAdminNetworkIds no incluye a Ji, y el bypass no aplica.
      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .send({
          targetUserId: Ji.id,
          amount: '100.00',
          reasonType: 'correction',
          reasonNotes: 'T-C3: con comodín, Ji sub-red indep — igual debe cortar',
        });
      expect(r.status).toBe(403);
      expect((r.body as { error?: string }).error).toBe('OUT_OF_SCOPE');
    });

    it('T-C4: admin_tenant → correct a Jd (red del admin) → 201 (regresión bypass admin)', async () => {
      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          targetUserId: Jd.id,
          amount: '100.00',
          reasonType: 'correction',
          reasonNotes: 'T-C4: admin bypass jerárquico intacto',
        });
      expect(r.status).toBe(201);
    });

    it('T-C5: admin_tenant → correct a Ji (sub-red indep) → 201 (regresión bypass admin)', async () => {
      // El admin no queda limitado por sub-red indep: su bypass jerárquico
      // no se rompió por el nuevo bypass del comodín.
      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          targetUserId: Ji.id,
          amount: '100.00',
          reasonType: 'correction',
          reasonNotes: 'T-C5: admin también sobre sub-red indep',
        });
      expect(r.status).toBe(201);
    });

    afterAll(async () => {
      // Cleanup: quitar overrides que este bloque agregó para no filtrar
      // estado a otros describes si el orden cambia.
      await clearOverride(E.id, 'wallet.correct');
      await clearOverride(E.id, 'wallet.correct_admin_network');
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
