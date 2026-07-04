/**
 * E2E: POST /tenant/house/inject-budget — fondeo de PRESUPUESTO a la Casa
 * (docs/16 §12).
 *
 * Área crítica (núcleo económico). Cubre:
 *
 *   - Validación DTO: amount inválido (0, negativo, > 2 decimales, no numérico),
 *     reason corto/faltante → 400.
 *   - Acceso: cajero1 sin house.inject_capital → 403.
 *   - Funcional: balance de la Casa sube, fila type='budget' con reason y
 *     mintTxId, wallet_tx type='mint' source='house_budget', entry en audit_log
 *     severity high action house.inject_budget.
 *   - Convivencia: NO rompe el flow de inject-capital estricto (regresión).
 *   - Historial: el fondeo aparece en GET /capital-injections.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';

interface InjectionRow {
  id: string;
  type: string;
  amount: string;
  reason: string;
  bankTransactionId: string | null;
  mintTxId: string | null;
  createdBy: string;
  notes: string | null;
}

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function getHouseBalance(ctx: TestApp): Promise<string> {
  const r = await ctx.tenantDb.execute(
    sql`SELECT w.balance FROM wallets w
        JOIN users u ON u.id = w.user_id
        WHERE u.username = '__casa__' LIMIT 1`,
  );
  const rows = r as unknown as Array<{ balance: string }>;
  return rows[0]!.balance;
}

describe('HouseController POST /inject-budget (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let cajero1Token: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajero1Token = await loginAsCajero1(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    // Aislamiento: cada test ve la Casa "limpia" (sin fondeos previos que
    // contaminen los deltas). Truncar respetando FK: primero las wallet_tx
    // vinculadas, después las injections.
    await ctx.tenantDb.execute(sql`
      DELETE FROM house_capital_injections;
    `);
    await ctx.tenantDb.execute(sql`
      DELETE FROM wallet_transactions
      WHERE source IN ('house_capital', 'house_budget');
    `);
    // Restaurar balance de la Casa a 0.
    await ctx.tenantDb.execute(sql`
      UPDATE wallets SET balance = '0'
      WHERE user_id = (SELECT id FROM users WHERE username = '__casa__');
    `);
  });

  describe('validaciones', () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ['amount = 0', { amount: '0', reason: 'presupuesto valido' }],
      ['amount negativo', { amount: '-100', reason: 'presupuesto valido' }],
      ['amount > 2 decimales', { amount: '100.123', reason: 'presupuesto valido' }],
      ['amount no numérico', { amount: '100abc', reason: 'presupuesto valido' }],
      ['reason muy corto', { amount: '100', reason: 'x' }],
      ['falta reason', { amount: '100' }],
    ];
    it.each(bad)('400 si %s', async (_label, body) => {
      const r = await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send(body);
      expect(r.status).toBe(400);
    });
  });

  describe('acceso', () => {
    it('403 si cajero1 (sin house.inject_capital) intenta fondear', async () => {
      const r = await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token)
        .send({
          amount: '100',
          reason: 'intento no autorizado',
          idempotencyKey: freshKey('budget'),
        });
      expect(r.status).toBe(403);
    });
  });

  describe('funcional', () => {
    it('fondeo exitoso: mintea a la Casa, fila type=budget, wallet_tx y audit', async () => {
      const balBefore = Number(await getHouseBalance(ctx));

      const r = await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '1000000',
          reason: 'presupuesto julio 2026',
          notes: 'primer fondeo del mes',
          idempotencyKey: freshKey('budget'),
        });
      expect(r.status).toBe(201);

      const body = r.body as InjectionRow;
      expect(body.type).toBe('budget');
      expect(body.amount).toBe('1000000.00');
      expect(body.reason).toBe('presupuesto julio 2026');
      expect(body.bankTransactionId).toBeNull();
      expect(body.mintTxId).not.toBeNull();
      expect(body.notes).toBe('primer fondeo del mes');

      // Balance de la Casa: subió exactamente el monto fondeado.
      const balAfter = Number(await getHouseBalance(ctx));
      expect(balAfter).toBeCloseTo(balBefore + 1_000_000, 2);

      // wallet_transaction del minteo: type='mint', source='house_budget'.
      const txRes = await ctx.tenantDb.execute(sql`
        SELECT type, source, amount FROM wallet_transactions
        WHERE id = ${body.mintTxId!}
      `);
      const txRow = (txRes as unknown as Array<{
        type: string;
        source: string;
        amount: string;
      }>)[0]!;
      expect(txRow.type).toBe('mint');
      expect(txRow.source).toBe('house_budget');
      expect(txRow.amount).toBe('1000000.00');

      // Audit log: entrada action house.inject_budget severity high.
      const audit = await ctx.request
        .get(
          `/tenant/audit-log?targetId=${body.id}&actionCode=house.inject_budget&limit=10`,
        )
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const entries = (audit.body as {
        entries: Array<{ actionCode: string; metadata: { severity?: string } }>;
      }).entries;
      const entry = entries.find((e) => e.actionCode === 'house.inject_budget');
      expect(entry).toBeDefined();
      expect(entry!.metadata.severity).toBe('high');
    });

    it('aparece en el historial GET /capital-injections', async () => {
      await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '500',
          reason: 'presupuesto historial',
          idempotencyKey: freshKey('budget'),
        });

      const hist = await ctx.request
        .get('/tenant/house/capital-injections?limit=10')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(hist.status).toBe(200);
      const injections = (hist.body as { injections: InjectionRow[] })
        .injections;
      const found = injections.find(
        (i) => i.type === 'budget' && i.reason === 'presupuesto historial',
      );
      expect(found).toBeDefined();
      expect(found!.amount).toBe('500.00');
    });

    it('múltiples fondeos suman correctamente (no hay unique bloqueando budgets)', async () => {
      // El unique parcial (WHERE bank_transaction_id IS NOT NULL) NO debe
      // bloquear varios budgets con bank_transaction_id = NULL.
      for (let i = 0; i < 3; i++) {
        const r = await ctx.request
          .post('/tenant/house/inject-budget')
          .set('Host', TEST_TENANT.host)
          .set('Authorization', adminToken)
          .send({
            amount: '100',
            reason: `fondeo ${i}`,
            idempotencyKey: freshKey('budget'),
          });
        expect(r.status).toBe(201);
      }
      const balAfter = Number(await getHouseBalance(ctx));
      expect(balAfter).toBeCloseTo(300, 2);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // F5: inject con operatorUserId — mintea al bankroll del socio INDEP
  // en vez de a la Casa (docs/16-adenda). Ver house.service.injectCapital /
  // injectBudget: si `operatorUserId` apunta a un user con
  // `is_independent_branch=true`, la ficha se mintea a la wallet de ese
  // operador; si es null/omit, comportamiento pre-F5 (mintea a la Casa).
  // Si el operator no existe o no es indep → 400 INJECT_OPERATOR_INVALID.
  // ────────────────────────────────────────────────────────────────────────

  describe('F5: inject con operatorUserId', () => {
    interface InjectionApiRow {
      id: string;
      type: string;
      amount: string;
      reason: string;
      bankTransactionId: string | null;
      mintTxId: string | null;
      operatorUserId: string | null;
    }

    async function makeUser(label: string, role: string): Promise<TestUser> {
      return createTestUser(ctx.request, adminToken, {
        suite: 'house-f5',
        label,
        role,
      });
    }

    /** Marca al user como socio INDEPENDIENTE (branch bank account + flag). */
    async function makeIndependent(
      socioId: string,
      cbu: string,
    ): Promise<void> {
      await ctx.tenantDb.execute(
        sql`UPDATE users
            SET is_independent_branch = true,
                branch_bank_account = ${cbu}
            WHERE id = ${socioId}`,
      );
    }

    async function getBalance(userId: string): Promise<number> {
      const rows = (await ctx.tenantDb.execute(
        sql`SELECT balance FROM wallets WHERE user_id = ${userId} LIMIT 1`,
      )) as unknown as Array<{ balance: string }>;
      return Number(rows[0]?.balance ?? 0);
    }

    /**
     * Crea una bank_transaction INCOMING en estado 'unmatched' vía HTTP,
     * lista para servir de respaldo a un injectCapital. `bankReference` único
     * por invocación (evita colisión con el unique index).
     */
    async function uploadBankTx(params: {
      bankAccount: string;
      amount: string;
    }): Promise<string> {
      const ref = freshKey('f5-ref');
      const res = await ctx.request
        .post('/tenant/bank-transactions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          bankAccount: params.bankAccount,
          amount: params.amount,
          currency: 'ARS',
          bankReference: ref,
          receivedAt: new Date().toISOString(),
          direction: 'incoming',
        });
      if (res.status !== 201) {
        throw new Error(
          `uploadBankTx falló: ${res.status} ${JSON.stringify(res.body)}`,
        );
      }
      return (res.body as { id: string }).id;
    }

    async function getBankTxStatus(bankTxId: string): Promise<string> {
      const rows = (await ctx.tenantDb.execute(
        sql`SELECT status FROM bank_transactions WHERE id = ${bankTxId} LIMIT 1`,
      )) as unknown as Array<{ status: string }>;
      return rows[0]!.status;
    }

    async function findInjectionByOperator(
      operatorUserId: string | null,
      type: 'capital' | 'budget',
    ): Promise<{
      id: string;
      operator_user_id: string | null;
      type: string;
    } | null> {
      const rows = (await ctx.tenantDb.execute(
        operatorUserId === null
          ? sql`SELECT id, operator_user_id, type
                FROM house_capital_injections
                WHERE operator_user_id IS NULL AND type = ${type}
                ORDER BY created_at DESC LIMIT 1`
          : sql`SELECT id, operator_user_id, type
                FROM house_capital_injections
                WHERE operator_user_id = ${operatorUserId} AND type = ${type}
                ORDER BY created_at DESC LIMIT 1`,
      )) as unknown as Array<{
        id: string;
        operator_user_id: string | null;
        type: string;
      }>;
      return rows[0] ?? null;
    }

    // ──────────────────────────────────────────────────────────────────
    // T-H1: injectCapital con operatorUserId=indep → indep +N, Casa 0.
    // ──────────────────────────────────────────────────────────────────

    it('T-H1: injectCapital con operatorUserId=indep mintea a la wallet del INDEP, NO a la Casa', async () => {
      const socioIndep = await makeUser('th1_indep', 'socio');
      await makeIndependent(socioIndep.id, 'CBU-INDEP-TH1');

      const bankTxId = await uploadBankTx({
        bankAccount: 'CBU-INDEP-TH1',
        amount: '500',
      });

      const casaBefore = Number(await getHouseBalance(ctx));
      const indepBefore = await getBalance(socioIndep.id);

      const r = await ctx.request
        .post('/tenant/house/inject-capital')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          bankTransactionId: bankTxId,
          operatorUserId: socioIndep.id,
        });
      expect([200, 201]).toContain(r.status);

      const body = r.body as InjectionApiRow;
      expect(body.type).toBe('capital');
      expect(body.operatorUserId).toBe(socioIndep.id);
      expect(body.bankTransactionId).toBe(bankTxId);
      expect(body.mintTxId).not.toBeNull();

      // Indep +500, Casa SIN cambios.
      const casaAfter = Number(await getHouseBalance(ctx));
      const indepAfter = await getBalance(socioIndep.id);
      expect(indepAfter - indepBefore).toBeCloseTo(500, 2);
      expect(casaAfter).toBeCloseTo(casaBefore, 2);

      // Fila en house_capital_injections con operator_user_id = indep, type=capital.
      const inj = await findInjectionByOperator(socioIndep.id, 'capital');
      expect(inj).not.toBeNull();
      expect(inj!.operator_user_id).toBe(socioIndep.id);
      expect(inj!.type).toBe('capital');

      // bank_tx quedó matched.
      expect(await getBankTxStatus(bankTxId)).toBe('matched');
    });

    // ──────────────────────────────────────────────────────────────────
    // T-H2: injectBudget con operatorUserId=indep → indep +N, Casa 0.
    // ──────────────────────────────────────────────────────────────────

    it('T-H2: injectBudget con operatorUserId=indep mintea a la wallet del INDEP', async () => {
      const socioIndep = await makeUser('th2_indep', 'socio');
      await makeIndependent(socioIndep.id, 'CBU-INDEP-TH2');

      const casaBefore = Number(await getHouseBalance(ctx));
      const indepBefore = await getBalance(socioIndep.id);

      const r = await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '200',
          reason: 'gift',
          operatorUserId: socioIndep.id,
          idempotencyKey: freshKey('budget'),
        });
      expect(r.status).toBe(201);

      const body = r.body as InjectionApiRow;
      expect(body.type).toBe('budget');
      expect(body.operatorUserId).toBe(socioIndep.id);
      expect(body.mintTxId).not.toBeNull();

      const casaAfter = Number(await getHouseBalance(ctx));
      const indepAfter = await getBalance(socioIndep.id);
      expect(indepAfter - indepBefore).toBeCloseTo(200, 2);
      expect(casaAfter).toBeCloseTo(casaBefore, 2);

      const inj = await findInjectionByOperator(socioIndep.id, 'budget');
      expect(inj).not.toBeNull();
      expect(inj!.operator_user_id).toBe(socioIndep.id);
      expect(inj!.type).toBe('budget');
    });

    // ──────────────────────────────────────────────────────────────────
    // T-H3: injectCapital SIN operatorUserId → mintea a la Casa (legacy).
    // ──────────────────────────────────────────────────────────────────

    it('T-H3: injectCapital SIN operatorUserId mintea a la Casa (regresión legacy)', async () => {
      // Creamos un indep "de control" para confirmar que NO se toca su wallet.
      const socioIndep = await makeUser('th3_indep', 'socio');
      await makeIndependent(socioIndep.id, 'CBU-INDEP-TH3');

      const bankTxId = await uploadBankTx({
        bankAccount: '0000000000000000000001',
        amount: '750',
      });

      const casaBefore = Number(await getHouseBalance(ctx));
      const indepBefore = await getBalance(socioIndep.id);

      const r = await ctx.request
        .post('/tenant/house/inject-capital')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          bankTransactionId: bankTxId,
          // sin operatorUserId
        });
      expect([200, 201]).toContain(r.status);

      const body = r.body as InjectionApiRow;
      expect(body.type).toBe('capital');
      expect(body.operatorUserId).toBeNull();

      // Casa +750, indep intacto.
      const casaAfter = Number(await getHouseBalance(ctx));
      const indepAfter = await getBalance(socioIndep.id);
      expect(casaAfter - casaBefore).toBeCloseTo(750, 2);
      expect(indepAfter).toBeCloseTo(indepBefore, 2);

      // Fila con operator_user_id NULL.
      const inj = await findInjectionByOperator(null, 'capital');
      expect(inj).not.toBeNull();
      expect(inj!.operator_user_id).toBeNull();

      expect(await getBankTxStatus(bankTxId)).toBe('matched');
    });

    // ──────────────────────────────────────────────────────────────────
    // T-H4: operatorUserId apunta a un user que NO es indep → 400
    //       INJECT_OPERATOR_INVALID reason='not_indep'.
    // ──────────────────────────────────────────────────────────────────

    it('T-H4: injectCapital con operatorUserId de user NO indep → 400 INJECT_OPERATOR_INVALID reason=not_indep', async () => {
      // Socio DEP: creado como rol 'socio' pero SIN toggle indep.
      const socioDep = await makeUser('th4_dep', 'socio');

      const bankTxId = await uploadBankTx({
        bankAccount: '0000000000000000000004',
        amount: '300',
      });

      const casaBefore = Number(await getHouseBalance(ctx));
      const depBefore = await getBalance(socioDep.id);

      const r = await ctx.request
        .post('/tenant/house/inject-capital')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          bankTransactionId: bankTxId,
          operatorUserId: socioDep.id,
        });
      expect(r.status).toBe(400);
      const body = r.body as {
        error: string;
        reason?: string;
        operatorUserId?: string;
      };
      expect(body.error).toBe('INJECT_OPERATOR_INVALID');
      expect(body.reason).toBe('not_indep');
      expect(body.operatorUserId).toBe(socioDep.id);

      // Nada minteado, bank_tx sigue unmatched.
      expect(Number(await getHouseBalance(ctx))).toBeCloseTo(casaBefore, 2);
      expect(await getBalance(socioDep.id)).toBeCloseTo(depBefore, 2);
      expect(await getBankTxStatus(bankTxId)).toBe('unmatched');
    });

    // ──────────────────────────────────────────────────────────────────
    // T-H5: operatorUserId apunta a un uuid random → 400 reason='not_found'.
    // ──────────────────────────────────────────────────────────────────

    it('T-H5: injectCapital con operatorUserId de uuid inexistente → 400 INJECT_OPERATOR_INVALID reason=not_found', async () => {
      const bankTxId = await uploadBankTx({
        bankAccount: '0000000000000000000005',
        amount: '150',
      });

      const casaBefore = Number(await getHouseBalance(ctx));
      // UUID v4-shaped (RFC 4122: variant 8/9/a/b, version 4) para pasar
      // el @IsUUID del DTO. Es v4-válido pero no existe en users.
      const randomUuid = '11111111-1111-4111-8111-111111111111';

      const r = await ctx.request
        .post('/tenant/house/inject-capital')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          bankTransactionId: bankTxId,
          operatorUserId: randomUuid,
        });
      expect(r.status).toBe(400);
      const body = r.body as {
        error: string;
        reason?: string;
        operatorUserId?: string;
      };
      expect(body.error).toBe('INJECT_OPERATOR_INVALID');
      expect(body.reason).toBe('not_found');
      expect(body.operatorUserId).toBe(randomUuid);

      // Nada minteado, bank_tx sigue unmatched.
      expect(Number(await getHouseBalance(ctx))).toBeCloseTo(casaBefore, 2);
      expect(await getBankTxStatus(bankTxId)).toBe('unmatched');
    });

    // ──────────────────────────────────────────────────────────────────
    // T-H6: injectBudget con operatorUserId inexistente → mismo error.
    // ──────────────────────────────────────────────────────────────────

    it('T-H6: injectBudget con operatorUserId de uuid inexistente → 400 INJECT_OPERATOR_INVALID reason=not_found', async () => {
      const casaBefore = Number(await getHouseBalance(ctx));
      const randomUuid = '22222222-2222-4222-8222-222222222222';

      const r = await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '80',
          reason: 'presupuesto a fantasma',
          operatorUserId: randomUuid,
          idempotencyKey: freshKey('budget'),
        });
      expect(r.status).toBe(400);
      const body = r.body as {
        error: string;
        reason?: string;
        operatorUserId?: string;
      };
      expect(body.error).toBe('INJECT_OPERATOR_INVALID');
      expect(body.reason).toBe('not_found');
      expect(body.operatorUserId).toBe(randomUuid);

      // Casa sin cambios.
      expect(Number(await getHouseBalance(ctx))).toBeCloseTo(casaBefore, 2);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // N3: namespacing interno de idempotencyKey.
  //
  // El cliente manda su key libre; el service la envuelve con `house_budget:`
  // antes de guardarla en wallet_transactions. Esto evita que una key
  // "hostil" (o coincidente) del cliente colisione con keys de otros flows
  // (deposit:, withdrawal:, bonus_grant:, etc.) que comparten el UNIQUE
  // global de `wallet_transactions.idempotency_key`. La key expuesta en
  // errores al cliente sigue siendo la CRUDA (unwrap en el service).
  // ────────────────────────────────────────────────────────────────────────

  describe('N3: idempotencyKey namespaceada internamente', () => {
    it('T-NS1: key del cliente que "parece" de otro flow (withdrawal:abc123) NO colisiona — mintea normalmente', async () => {
      // La key del cliente sugiere un flow distinto (withdrawal:).
      // Si el service la guardara cruda, y en el futuro otro flow del panel
      // usara literalmente "withdrawal:abc123", el segundo request devolvería
      // la tx del primero (fuga silenciosa). Con el namespacing interno la
      // key real es "house_budget:withdrawal:abc123" — sin colisión posible.
      const hostileLookingKey = 'withdrawal:abc123-ns1';

      const balBefore = Number(await getHouseBalance(ctx));

      const r = await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '750',
          reason: 'ns1: key parecida a withdrawal',
          idempotencyKey: hostileLookingKey,
        });
      expect(r.status).toBe(201);
      const body = r.body as InjectionRow;
      expect(body.type).toBe('budget');
      expect(body.amount).toBe('750.00');

      // El mint efectivamente ocurrió: balance +750.
      const balAfter = Number(await getHouseBalance(ctx));
      expect(balAfter).toBeCloseTo(balBefore + 750, 2);

      // La key GUARDADA en wallet_transactions está prefijada; la cruda del
      // cliente NO existe como key almacenada.
      const stored = (await ctx.tenantDb.execute(sql`
        SELECT idempotency_key FROM wallet_transactions
        WHERE id = ${body.mintTxId!}
      `)) as unknown as Array<{ idempotency_key: string }>;
      expect(stored[0]!.idempotency_key).toBe(`house_budget:${hostileLookingKey}`);

      // Sanity: no hay ninguna otra tx con la key cruda del cliente
      // (confirma que el service no la guardó desnuda por accidente).
      const raw = (await ctx.tenantDb.execute(sql`
        SELECT COUNT(*)::int AS n FROM wallet_transactions
        WHERE idempotency_key = ${hostileLookingKey}
      `)) as unknown as Array<{ n: number }>;
      expect(raw[0]!.n).toBe(0);
    });

    it('T-NS2: dos requests con la MISMA idempotencyKey libre → segunda devuelve la primera (idempotency preservada dentro del namespace)', async () => {
      const clientKey = freshKey('ns2-shared');

      const balBefore = Number(await getHouseBalance(ctx));

      const r1 = await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '400',
          reason: 'ns2: primer request',
          idempotencyKey: clientKey,
        });
      expect(r1.status).toBe(201);
      const body1 = r1.body as InjectionRow;

      // Segunda vez: MISMOS params, MISMA key → debe devolver la MISMA fila.
      const r2 = await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '400',
          reason: 'ns2: primer request',
          idempotencyKey: clientKey,
        });
      expect(r2.status).toBe(201);
      const body2 = r2.body as InjectionRow;

      // Idempotency real: misma injection id, mismo mintTxId, un solo mint.
      expect(body2.id).toBe(body1.id);
      expect(body2.mintTxId).toBe(body1.mintTxId);

      const balAfter = Number(await getHouseBalance(ctx));
      expect(balAfter).toBeCloseTo(balBefore + 400, 2);

      // Solo UNA fila de wallet_transactions bajo la key prefijada.
      const walletTxCount = (await ctx.tenantDb.execute(sql`
        SELECT COUNT(*)::int AS n FROM wallet_transactions
        WHERE idempotency_key = ${`house_budget:${clientKey}`}
      `)) as unknown as Array<{ n: number }>;
      expect(walletTxCount[0]!.n).toBe(1);

      // Y solo UNA fila de house_capital_injections.
      const injCount = (await ctx.tenantDb.execute(sql`
        SELECT COUNT(*)::int AS n FROM house_capital_injections
        WHERE mint_tx_id = ${body1.mintTxId!}
      `)) as unknown as Array<{ n: number }>;
      expect(injCount[0]!.n).toBe(1);
    });

    it('T-NS3: MISMA key con params distintos → 409 IDEMPOTENCY_CONFLICT reporta la key CRUDA del cliente (no la prefijada)', async () => {
      const clientKey = freshKey('ns3-conflict');

      const r1 = await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '100',
          reason: 'ns3: request original',
          idempotencyKey: clientKey,
        });
      expect(r1.status).toBe(201);

      // Segundo request con MISMA key pero AMOUNT distinto → conflict.
      const r2 = await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '999',
          reason: 'ns3: request original',
          idempotencyKey: clientKey,
        });
      expect(r2.status).toBe(409);
      const body = r2.body as {
        error: string;
        idempotencyKey?: string;
        message?: string;
      };
      expect(body.error).toBe('IDEMPOTENCY_CONFLICT');
      // Clave: la key expuesta al cliente es la CRUDA (unwrap), NO la
      // prefijada. Si el cliente ve `house_budget:<x>` no sabe qué hacer.
      expect(body.idempotencyKey).toBe(clientKey);
      expect(body.idempotencyKey).not.toContain('house_budget:');
    });
  });
});
