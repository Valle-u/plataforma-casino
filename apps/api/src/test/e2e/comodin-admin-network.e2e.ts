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
 *   - E (rol empleado) con `wallet.load_admin_network` → el alias pasa el
 *     gate del PermissionsGuard, pero el rol empleado está BLOQUEADO de
 *     wallet.load (docs/19 + LEYES R7) → 403 EMPLOYEE_LOAD_BLOCKED aunque el
 *     bypass de scope alcanzaría a Jd (el bloqueo por rol corta primero).
 *   - E con `deposits.approve_admin_network` → puede aprobar deposits
 *     de Jd, no de Ji.
 *   - E con `bonuses.grant_manual_admin_network` → puede otorgar bono
 *     a Jd, no de Ji.
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

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Fondea la tesorería (__casa__) por SQL — de ahí salen correcciones y bonos. */
async function fundHouse(ctx: TestApp): Promise<void> {
  await ctx.tenantDb.execute(
    sql`UPDATE wallets SET balance = '1000000'
        WHERE user_id = (SELECT id FROM users WHERE username = '__casa__')`,
  );
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

    it('rol empleado: el gate pasa por alias expansion, pero el bloqueo de wallet.load por rol da 403 EMPLOYEE_LOAD_BLOCKED', async () => {
      // El alias expande a wallet.load y el PermissionsGuard deja pasar el
      // request; es el bloqueo de negocio (docs/19) el que corta con
      // EMPLOYEE_LOAD_BLOCKED. Si el gate NO reconociera el alias, el error
      // sería MISSING_PERMISSION — esta aserción cubre ambas cosas.
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .set('Idempotency-Key', freshKey('c-alias-gate'))
        .send({ targetUserId: Jd.id, amount: '100.00' });
      expect(r.status).toBe(403);
      expect((r.body as { error?: string }).error).toBe('EMPLOYEE_LOAD_BLOCKED');
    });

    it('rol empleado: no carga a Jd (red del admin) → 403 EMPLOYEE_LOAD_BLOCKED', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .set('Idempotency-Key', freshKey('c-load-jd'))
        .send({ targetUserId: Jd.id, amount: '500.00' });
      expect(r.status).toBe(403);
      expect((r.body as { error?: string }).error).toBe('EMPLOYEE_LOAD_BLOCKED');
    });

    it('rol empleado: tampoco a Ji → 403 OUT_OF_SCOPE (la sub-red indep la corta el ScopeGuard antes que el bloqueo por rol)', async () => {
      const r = await ctx.request
        .post('/tenant/wallet/load')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .set('Idempotency-Key', freshKey('c-load-ji'))
        .send({ targetUserId: Ji.id, amount: '500.00' });
      expect(r.status).toBe(403);
      // El ScopeGuard corre ANTES que el handler: Ji vive en la sub-red del
      // socio independiente, inalcanzable para el comodín del admin
      // (aislamiento monetario) → corta con OUT_OF_SCOPE. EMPLOYEE_LOAD_BLOCKED
      // solo se alcanza para targets in-scope (tests 1 y 2).
      expect((r.body as { error?: string }).error).toBe('OUT_OF_SCOPE');
    });

    it('aislamiento: admin_tenant NO puede cargar fichas a Ji (sub-red indep = casino aparte)', async () => {
      // Auditoría economía (2026-07): la sub-red del socio independiente es un
      // casino aparte que banca lo suyo. Ningún actor externo la fondea, ni
      // siquiera el admin_tenant. `wallet.load_admin_network` está en
      // MONEY_MOVE_BYPASS_PERMS → el ScopeGuard corta antes de mover fichas.
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
      expect(r.status).toBe(403);
      expect((r.body as { error?: string }).error).toBe('OUT_OF_SCOPE');
    });
  });

  describe('deposits.approve_admin_network', () => {
    let depJd: string; // deposit id de Jd
    let depJi: string; // deposit id de Ji

    beforeAll(async () => {
      await grantOverride(E.id, 'deposits.approve_admin_network');
      await relogin();

      // Crear un payment method reutilizable directo por DB (evita
      // acoplar el test al DTO de payment methods). Jd (red dependiente)
      // usa uno tenant-level (owner_id NULL); Ji (sub-red del socio
      // independiente I) usa uno del padre directo I — regla Sprint 53/55
      // (DepositsService.create: method.ownerId === parent.parentUserId).
      const suitePm = `comodin-dep-${Date.now().toString(36)}`;
      const methodJd = await createPaymentMethod(suitePm + '-jd');
      const methodJi = await createPaymentMethod(suitePm + '-ji', I.id);

      // Jd crea deposit.
      const tokJd = await loginAs(ctx.request, Jd.username, Jd.password);
      const rJd = await ctx.request
        .post('/tenant/deposits')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', tokJd)
        .send({
          methodId: methodJd,
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
          methodId: methodJi,
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
    //   - El cupo mensual del empleado E se fija por endpoint.
    //   - La Casa se fondea por SQL para tener saldo del que drenar.

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
      await fundHouse(ctx);

      // Cupo mensual para E (empleado) — por endpoint (E tiene rol empleado).
      await ctx.request
        .patch(`/tenant/correction/user/${E.id}/cap`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ cap: '100000' })
        .expect(200);

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
        .set('Idempotency-Key', freshKey('c-corr-jd'))
        .send({
          targetUserId: Jd.id,
          amount: '100.00',
          reasonType: 'correction',
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

    it('T-C4: admin_tenant → correct a Jd (red del admin) → 403 CORRECTION_NOT_EMPLOYEE', async () => {
      // La corrección quedó SOLO para empleados de la red central (docs/19):
      // el admin carga con wallet.load (sale de la tesorería __casa__). El
      // bypass jerárquico lo deja pasar por el ScopeGuard, pero el service
      // lo bloquea con 403 CORRECTION_NOT_EMPLOYEE.
      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('c-corr-admin'))
        .send({
          targetUserId: Jd.id,
          amount: '100.00',
          reasonType: 'correction',
          reasonNotes: 'T-C4: admin bloqueado en corrección',
        });
      expect(r.status).toBe(403);
      expect((r.body as { error?: string }).error).toBe('CORRECTION_NOT_EMPLOYEE');
    });

    it('T-C5: admin_tenant → correct a Ji (sub-red indep) → 403 (aislamiento monetario)', async () => {
      // Auditoría economía (2026-07): el admin NO puede fondear un jugador de
      // la sub-red independiente vía corrección (la Casa no banca ese casino
      // aparte). `wallet.correct_admin_network` ∈ MONEY_MOVE_BYPASS_PERMS → el
      // ScopeGuard corta con OUT_OF_SCOPE antes de tocar el wallet.
      const r = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          targetUserId: Ji.id,
          amount: '100.00',
          reasonType: 'correction',
          reasonNotes: 'T-C5: admin NO debe poder sobre sub-red indep',
        });
      expect(r.status).toBe(403);
      expect((r.body as { error?: string }).error).toBe('OUT_OF_SCOPE');
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

    async function setCap(amount: string): Promise<void> {
      const r = await ctx.request
        .patch(`/tenant/correction/user/${E.id}/cap`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ cap: amount });
      if (r.status !== 200) {
        throw new Error(`setCap falló ${r.status} ${JSON.stringify(r.body)}`);
      }
    }

    async function getStatus(): Promise<{ cap: string; used: string; remaining: string }> {
      const r = await ctx.request
        .get('/tenant/correction/status')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken);
      expect(r.status).toBe(200);
      return r.body as { cap: string; used: string; remaining: string };
    }

    /** Suma exacta del cupo consumido por E este mes (mismo filtro que el service). */
    async function totalUsedByE(): Promise<string> {
      const rows = (await ctx.tenantDb.execute(
        sql`SELECT COALESCE(SUM(amount), 0)::text AS total
            FROM wallet_transactions
            WHERE created_by = ${E.id}
              AND created_at >= date_trunc('month', now())
              AND ((source = 'employee_correction' AND type = 'adjustment')
                OR (source = 'bonus_grant' AND type = 'bonus_funding'))`,
      )) as unknown as Array<{ total: string }>;
      return rows[0]?.total ?? '0';
    }

    async function grantBonus(
      userId: string,
      amount: string,
      label: string,
    ): Promise<{ status: number; body: { error?: string; remaining?: string } }> {
      const r = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .set('Idempotency-Key', freshKey(label))
        .send({
          userId,
          definitionId: defId,
          amount,
          reason: 'test cupo empleado bonos',
        });
      return { status: r.status, body: r.body as { error?: string; remaining?: string } };
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
      await grantOverride(E.id, 'bonuses.grant_manual_admin_network');
      // wallet.correct_admin_network: para leer /correction/status y probar
      // que correcciones y bonos comparten el mismo contador (R7).
      await grantOverride(E.id, 'wallet.correct_admin_network');
      await relogin();

      // Fondear la TESORERÍA (__casa__). LEYES E3 (2026-07-31): los bonos
      // de planillas del admin (incl. grants de empleados con comodín)
      // salen de la Casa, no de la wallet personal del admin.
      await fundHouse(ctx);

      // LEYES R7 (2026-08): el grant de un empleado consume su cupo mensual.
      // Sin cupo (>0) el grant 403 NO_CAP_CONFIGURED, así que fijamos uno
      // holgado para el resto de los tests del describe.
      await setCap('100000');

      // Crear una definición de bono mínima directo por DB.
      const suite = `comodin-bono-${Date.now().toString(36)}`;
      const me = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const adminId = (me.body as { user: { id: string } }).user.id;
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

    it('grant sin cupo configurado → 403 NO_CAP_CONFIGURED', async () => {
      await setCap('0');
      const r = await grantBonus(Jd.id, '100', 'c-bonus-nocap');
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('NO_CAP_CONFIGURED');
    });

    it('grant con cupo suficiente → 200 y consume el cupo (tx bonus_funding de E)', async () => {
      await setCap('500');
      const usedBefore = Number(await totalUsedByE());
      const r = await grantBonus(Jd.id, '200', 'c-bonus-cap');
      expect([200, 201]).toContain(r.status);
      const usedAfter = Number(await totalUsedByE());
      expect(usedAfter - usedBefore).toBeCloseTo(200, 2);

      const status = await getStatus();
      expect(Number(status.cap)).toBeCloseTo(500, 2);
      expect(Number(status.used)).toBeCloseTo(usedAfter, 2);
    });

    it('grant que supera el cupo → 409 EMPLOYEE_CAP_EXCEEDED', async () => {
      // used acumula todos los grants de E del describe. Cap = used + 50:
      // queda un margen de 50, y el grant de 150 lo supera.
      const used = Number(await totalUsedByE());
      const cap = used + 50;
      await setCap(cap.toFixed(2));
      const r = await grantBonus(Jd.id, '150', 'c-bonus-over');
      expect(r.status).toBe(409);
      expect(r.body.error).toBe('EMPLOYEE_CAP_EXCEEDED');
      expect(Number(r.body.remaining)).toBeCloseTo(50, 2);
    });

    it('la corrección ve el MISMO contador: el cupo consumido por bonos bloquea la corrección', async () => {
      // used incluye todos los bonos del empleado. Cap = used + 100 →
      // remaining 100. Una corrección de 150 → 409; la de 100 → 201 y llega
      // al tope (contador compartido, docs/19 + LEYES R7).
      const used = Number(await totalUsedByE());
      const cap = used + 100;
      await setCap(cap.toFixed(2));
      const status = await getStatus();
      expect(Number(status.remaining)).toBeCloseTo(100, 2);

      const blocked = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .set('Idempotency-Key', freshKey('c-cap-corr-blocked'))
        .send({ targetUserId: Jd.id, amount: '150', reasonType: 'correction' });
      expect(blocked.status).toBe(409);
      expect((blocked.body as { error?: string }).error).toBe('EMPLOYEE_CAP_EXCEEDED');

      const ok = await ctx.request
        .post('/tenant/correction')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', comodinToken)
        .set('Idempotency-Key', freshKey('c-cap-corr-ok'))
        .send({ targetUserId: Jd.id, amount: '100', reasonType: 'correction' });
      expect(ok.status).toBe(201);
      const after = await getStatus();
      expect(Number(after.remaining)).toBeCloseTo(0, 2);
      expect(Number(after.used)).toBeCloseTo(cap, 2);
    });

    it('regresión: el admin otorga bono SIN cupo (no consume el del empleado)', async () => {
      await setCap('0'); // el empleado queda sin cupo
      const r = await ctx.request
        .post('/tenant/bonuses/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('c-bonus-admin-reg'))
        .send({
          userId: Jd.id,
          definitionId: defId,
          amount: '150',
          reason: 'regresion admin sin cupo',
        });
      expect([200, 201]).toContain(r.status);
    });

    afterAll(async () => {
      // Limpieza defensiva: no filtrar overrides a describes siguientes.
      await clearOverride(E.id, 'bonuses.grant_manual_admin_network');
      await clearOverride(E.id, 'wallet.correct_admin_network');
    });
  });

  describe('D1: PATCH cap con ScopeGuard + house.set_employee_cap_admin_network', () => {
    // D1 (docs de la migración 0052):
    //   PATCH /tenant/correction/user/:userId/cap fijaba el cupo mensual
    //   de correcciones de un empleado y solo pedía `users.edit`. Como
    //   `users.edit` está en INDEPENDENT_BRANCH_AUTO_PERMISSIONS, un socio
    //   independiente podía subirle el cupo a un empleado de la red del
    //   admin y luego drenar la Casa vía POST /tenant/correction.
    //
    //   Fix: setCap ahora lleva @ScopeTarget('userId','param') +
    //   @AdminNetworkBypass('house.set_employee_cap_admin_network'), así el
    //   ScopeGuard limita el target a la sub-red del actor (con bypass
    //   admin_network para el comodín del admin).
    //
    // Topología reutilizada del suite:
    //   admin_tenant
    //   ├─ D (dep)
    //   │  └─ Jd
    //   ├─ I (indep, is_independent_branch=true)  ← el atacante en el exploit
    //   │  └─ Ji
    //   └─ E (empleado del admin — víctima del exploit original)
    //
    // Nuevos users para D1:
    //   Ei = empleado bajo I (para T-D1d: I fija cupo en SU propia rama).

    let socioIndepToken: string;
    let Ei: TestUser; // empleado bajo I (sub-red indep)

    async function getHouseBalance(): Promise<string> {
      const rows = (await ctx.tenantDb.execute(
        sql`SELECT w.balance FROM wallets w
            JOIN users u ON u.id = w.user_id
            WHERE u.username = '__casa__' LIMIT 1`,
      )) as unknown as Array<{ balance: string }>;
      return rows[0]!.balance;
    }

    async function getEmployeeCap(userId: string): Promise<string> {
      const rows = (await ctx.tenantDb.execute(
        sql`SELECT employee_correction_cap_monthly AS cap FROM users
            WHERE id = ${userId} LIMIT 1`,
      )) as unknown as Array<{ cap: string }>;
      return rows[0]!.cap;
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
      // I no llegó a la sub-red vía branches.service (solo se marcó el flag
      // por SQL en el beforeAll global), así que replicamos manualmente el
      // auto-grant de INDEPENDENT_BRANCH_AUTO_PERMISSIONS que necesitamos
      // para tocar el gate @RequirePermissions('users.edit'). Sin este
      // override el request se cortaría en el PermissionsGuard antes de
      // llegar al ScopeGuard (que es lo que queremos probar).
      await grantOverride(I.id, 'users.edit');

      // Empleado bajo I — target válido dentro de la sub-red indep para
      // T-D1d (I fija cupo a SU propio empleado → dentro de scope).
      const suite = `comodin-d1-${Date.now().toString(36)}`;
      Ei = await createTestUser(ctx.request, adminToken, {
        suite,
        label: 'empIndep',
        role: 'empleado',
      });
      await setParent(ctx.request, adminToken, Ei.id, I.id, 'empleado_de_socio');

      // Login inicial del socio indep (sin comodín aún — se agrega en T-D1b).
      socioIndepToken = await loginAs(ctx.request, I.username, I.password);
    });

    it('T-D1a: socio indep SIN comodín → PATCH cap a E (empleado del admin) → 403 OUT_OF_SCOPE', async () => {
      // Repro del exploit original (pre-fix): I tiene users.edit por
      // auto-grant, apunta al empleado del admin (E). Sin @ScopeTarget
      // hubiera devuelto 200 y el cap se habría cambiado. Con el fix el
      // ScopeGuard corta porque E no está en la sub-red de I y I no
      // tiene el comodín.
      const capBefore = await getEmployeeCap(E.id);
      const r = await ctx.request
        .patch(`/tenant/correction/user/${E.id}/cap`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', socioIndepToken)
        .send({ cap: '9999999.00' });
      expect(r.status).toBe(403);
      expect((r.body as { error?: string }).error).toBe('OUT_OF_SCOPE');
      // Sanity: el cupo NO cambió.
      const capAfter = await getEmployeeCap(E.id);
      expect(capAfter).toBe(capBefore);
    });

    it('T-D1b: socio indep CON comodín → PATCH cap a E (empleado del admin) → 403 OUT_OF_SCOPE', async () => {
      // Expectativa de seguridad: el comodín `house.set_employee_cap_admin_network`
      // sirve para el comodín DEL ADMIN (empleado sin descendencia que
      // opera sobre toda la red del admin). NO está pensado para que un
      // socio independiente escale hacia la red del admin.
      //
      // Nota: hoy el ScopeGuard solo chequea `target ∈ getAdminNetworkIds`
      // + `actor tiene el perm` — no valida que el actor pertenezca a la
      // red del admin. Si este test devuelve 200, hay un defecto abierto
      // (indep con comodín se cuela). El test lo cristaliza como
      // regresión: la expectativa aquí es 403 igual que en T-D1a.
      await grantOverride(I.id, 'house.set_employee_cap_admin_network');
      // Relogin de I para refrescar el JWT con el permiso nuevo.
      socioIndepToken = await loginAs(ctx.request, I.username, I.password);

      const capBefore = await getEmployeeCap(E.id);
      const r = await ctx.request
        .patch(`/tenant/correction/user/${E.id}/cap`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', socioIndepToken)
        .send({ cap: '9999999.00' });
      expect(r.status).toBe(403);
      expect((r.body as { error?: string }).error).toBe('OUT_OF_SCOPE');
      const capAfter = await getEmployeeCap(E.id);
      expect(capAfter).toBe(capBefore);
    });

    it('T-D1c: admin_tenant → PATCH cap a E (empleado de su red) → 200 (regresión)', async () => {
      // Bypass jerárquico intacto: admin_tenant sigue pudiendo fijar el
      // cupo de cualquier empleado de la red del admin.
      const newCap = '54321.00';
      const r = await ctx.request
        .patch(`/tenant/correction/user/${E.id}/cap`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ cap: newCap });
      expect(r.status).toBe(200);
      expect(await getEmployeeCap(E.id)).toBe(newCap);
    });

    it('T-D1d: socio indep → PATCH cap a Ei (empleado de SU propia rama) → 200 (in-scope)', async () => {
      // Ei es descendiente de I ⇒ ScopeGuard pasa por descendants (no
      // hace falta el comodín para este caso).
      const newCap = '7777.00';
      const r = await ctx.request
        .patch(`/tenant/correction/user/${Ei.id}/cap`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', socioIndepToken)
        .send({ cap: newCap });
      expect(r.status).toBe(200);
      expect(await getEmployeeCap(Ei.id)).toBe(newCap);
    });

    it('T-D1e: exploit E2E — indep no puede escalar cap de E ⇒ Casa no se drena', async () => {
      // Regresión del exploit completo del bug D1:
      //   1) I (socio indep) intenta subir el cupo de E (empleado del
      //      admin) a un número enorme via PATCH /correction/user/E/cap.
      //   2) Sin fix: 200 OK, cap de E queda en 9_999_999.
      //   3) E (con wallet.correct+comodín ya en el suite anterior) hace
      //      POST /correction targetUserId=Jd amount=grande → drena Casa.
      //
      // Con fix: (1) devuelve 403 → cap de E no cambia → aunque E igual
      // pueda hacer correcciones dentro de su cupo previo, no puede
      // drenar la Casa por encima de él por vía de esta escalada.
      //
      // Chequeamos:
      //   - PATCH devuelve 403.
      //   - Cap de E queda igual (sin escalada).
      //   - Balance de la Casa no se movió por el request bloqueado.
      const capBefore = await getEmployeeCap(E.id);
      const houseBefore = await getHouseBalance();

      const rPatch = await ctx.request
        .patch(`/tenant/correction/user/${E.id}/cap`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', socioIndepToken)
        .send({ cap: '9999999.00' });
      expect(rPatch.status).toBe(403);
      expect((rPatch.body as { error?: string }).error).toBe('OUT_OF_SCOPE');

      const capAfter = await getEmployeeCap(E.id);
      const houseAfter = await getHouseBalance();
      expect(capAfter).toBe(capBefore);
      expect(houseAfter).toBe(houseBefore);
    });

    afterAll(async () => {
      // Limpieza defensiva para no filtrar overrides a otras suites si el
      // orden cambia.
      await clearOverride(I.id, 'users.edit');
      await clearOverride(I.id, 'house.set_employee_cap_admin_network');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // R3/R4 (LEYES): modelo LIMPIO de permisos de plata. El rol operador NO trae
  //   los permisos de mover plata. El cálculo de permisos efectivos los agrega
  //   DINÁMICAMENTE solo a los users que están dentro de una sub-red
  //   INDEPENDIENTE (el socio o un ancestro con is_independent_branch). Un
  //   cajero cableado bajo un socio DEPENDIENTE queda comercial puro; el
  //   creado por un socio INDEPENDIENTE hereda los 7. Cierra el hallazgo de la
  //   auditoría 2026-07.
  //
  //   Topología: el create AUTO-PARENTA a un operador (cajero/distri) bajo su
  //   creador operador (socio/distribuidor). Por eso alcanza con que D/I creen
  //   el cajero — queda colgado de ellos automáticamente y hereda (o no) los
  //   perms de plata según la sub-red.
  // ──────────────────────────────────────────────────────────────────────
  describe('R3/R4: perms de plata solo en la red independiente', () => {
    const MONEY = [
      'wallet.load',
      'wallet.unload',
      'deposits.approve',
      'deposits.reject',
      'withdrawals.approve',
      'withdrawals.reject',
      'withdrawals.process',
    ];

    async function effectivePerms(bearer: string): Promise<string[]> {
      const me = await ctx.request
        .get('/tenant/auth/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', bearer);
      return (me.body as { user: { effectivePermissions: string[] } }).user
        .effectivePermissions;
    }

    it('cajero de socio DEPENDIENTE sin perms de plata; el de socio INDEPENDIENTE los recibe', async () => {
      const suf = Date.now().toString(36);

      // D (socio DEPENDIENTE) crea un cajero → comercial puro, sin perms de plata.
      const dToken = await loginAs(ctx.request, D.username, D.password);
      const depUser = `cajdep${suf}`;
      const depPass = `pwd-cajdep-${suf}-2026`;
      const rDep = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', dToken)
        .send({
          username: depUser,
          password: depPass,
          displayName: 'Caj Dep',
          roleCode: 'cajero',
        });
      expect(rDep.status).toBe(201);
      // El cajero queda auto-parenteado bajo D (red dependiente). Aun bien
      // ubicado en la red dependiente, NO debe tener perms de plata.
      const depPerms = await effectivePerms(
        await loginAs(ctx.request, depUser, depPass),
      );
      for (const c of MONEY) expect(depPerms).not.toContain(c);

      // I (socio INDEPENDIENTE) crea un cajero → queda auto-parenteado bajo I
      // → hereda los 7 perms de plata por estar en la sub-red independiente.
      const iToken = await loginAs(ctx.request, I.username, I.password);
      const indUser = `cajind${suf}`;
      const indPass = `pwd-cajind-${suf}-2026`;
      const rInd = await ctx.request
        .post('/tenant/users')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', iToken)
        .send({
          username: indUser,
          password: indPass,
          displayName: 'Caj Ind',
          roleCode: 'cajero',
        });
      expect(rInd.status).toBe(201);
      const indPerms = await effectivePerms(
        await loginAs(ctx.request, indUser, indPass),
      );
      for (const c of MONEY) expect(indPerms).toContain(c);

      // Ji es un JUGADOR (usuario_final) de la sub-red independiente. Aunque
      // está dentro de la sub-red, NO es rol operador → el cálculo dinámico NO
      // debe darle perms de plata (un jugador con wallet.load sería una fuga).
      const jiPerms = await effectivePerms(
        await loginAs(ctx.request, Ji.username, Ji.password),
      );
      for (const c of MONEY) expect(jiPerms).not.toContain(c);
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

async function createPaymentMethod(code: string, ownerId?: string): Promise<string> {
  const client = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await client<{ id: string }[]>`
      INSERT INTO payment_methods (id, code, name, type, config, is_active, owner_id)
      VALUES (gen_random_uuid(), ${code}, ${code + ' display'}, 'bank_transfer', '{"cbu":"0000000000000000000000"}'::jsonb, true, ${ownerId ?? null})
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
