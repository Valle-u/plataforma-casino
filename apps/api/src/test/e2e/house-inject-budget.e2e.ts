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
 *   - Tope mensual (treasury.monthly_mint_budget): dentro del tope OK, excede
 *     → 409 MINT_BUDGET_EXCEEDED, modo fondeo bypasea, GET /mint-budget refleja
 *     lo minteado este mes.
 *   - Historial: el fondeo aparece en GET /capital-injections.
 *
 * NOTA (2026-07): `injectCapital` (atado a bank_tx) se ELIMINÓ. injectBudget es
 * el único minteo. Los tests T-H1/T-H3/T-H4/T-H5 (capital) se removieron.
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
  // F5: injectBudget con operatorUserId — mintea al bankroll del socio INDEP
  // en vez de a la Casa (docs/16-adenda). Si `operatorUserId` apunta a un user
  // con `is_independent_branch=true`, la ficha se mintea a la wallet de ese
  // operador; si es null/omit, mintea a la Casa. Si el operator no existe o no
  // es indep → 400 INJECT_OPERATOR_INVALID.
  //
  // NOTA: los casos T-H1/T-H3/T-H4/T-H5 usaban injectCapital (bank_tx), que se
  // eliminó. Quedan los casos de injectBudget (T-H2, T-H6).
  // ────────────────────────────────────────────────────────────────────────

  describe('F5: injectBudget con operatorUserId', () => {
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

    async function findInjectionByOperator(
      operatorUserId: string | null,
      type: 'budget',
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
    // T-H6: injectBudget con operatorUserId inexistente → 400 not_found.
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
  // TOPE MENSUAL de minteo (treasury.monthly_mint_budget).
  //
  // injectBudget es el único método de creación de fichas; queda capado por
  // este setting por mes calendario UTC. `mintedThisMonth` = Σ amount de las
  // injections type='budget' del mes en curso. Sin modo `fondeo`, exceder el
  // tope → 409 MINT_BUDGET_EXCEEDED. Con `fondeo: true` se bypasea a propósito.
  // ────────────────────────────────────────────────────────────────────────

  describe('tope mensual de minteo', () => {
    /** Setea el tope mensual vía el endpoint de settings. */
    async function setBudget(value: number): Promise<void> {
      const r = await ctx.request
        .patch('/tenant/settings/treasury.monthly_mint_budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value });
      if (r.status !== 200 && r.status !== 201) {
        throw new Error(
          `setBudget falló: ${r.status} ${JSON.stringify(r.body)}`,
        );
      }
    }

    afterEach(async () => {
      // Limpiar el tope para no contaminar otros describes (el beforeEach
      // top-level solo trunca injections/wallet_tx, no los settings).
      await ctx.tenantDb.execute(
        sql`DELETE FROM tenant_settings WHERE key = 'treasury.monthly_mint_budget'`,
      );
    });

    it('injectBudget dentro del tope → 201 OK', async () => {
      await setBudget(1000);
      const r = await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '800',
          reason: 'dentro del tope',
          idempotencyKey: freshKey('cap-ok'),
        });
      expect(r.status).toBe(201);
      expect((r.body as InjectionRow).amount).toBe('800.00');
    });

    it('injectBudget que excede el tope → 409 MINT_BUDGET_EXCEEDED con payload accionable', async () => {
      await setBudget(1000);
      // Primer fondeo consume 600 del tope.
      const first = await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '600',
          reason: 'primer tramo',
          idempotencyKey: freshKey('cap-1'),
        });
      expect(first.status).toBe(201);

      const balBefore = Number(await getHouseBalance(ctx));

      // 600 + 500 = 1100 > 1000 → rechazado.
      const r = await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '500',
          reason: 'excede el tope',
          idempotencyKey: freshKey('cap-2'),
        });
      expect(r.status).toBe(409);
      const body = r.body as {
        error: string;
        monthlyBudget: string;
        mintedThisMonth: string;
        available: string;
        requested: string;
      };
      expect(body.error).toBe('MINT_BUDGET_EXCEEDED');
      expect(body.monthlyBudget).toBe('1000.00');
      expect(body.mintedThisMonth).toBe('600.00');
      expect(body.available).toBe('400.00');
      expect(body.requested).toBe('500.00');

      // No se minteó nada: balance de la Casa intacto.
      const balAfter = Number(await getHouseBalance(ctx));
      expect(balAfter).toBeCloseTo(balBefore, 2);
    });

    it('injectBudget con fondeo:true que excede el tope → 201 (bypasea)', async () => {
      await setBudget(100);
      const balBefore = Number(await getHouseBalance(ctx));

      const r = await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '5000',
          reason: 'reposición grande',
          fondeo: true,
          idempotencyKey: freshKey('cap-fondeo'),
        });
      expect(r.status).toBe(201);
      const body = r.body as InjectionRow;
      expect(body.type).toBe('budget');
      expect(body.amount).toBe('5000.00');
      // El reason queda marcado como FONDEO para trazabilidad.
      expect(body.reason).toBe('FONDEO: reposición grande');

      // Se minteó igual: balance de la Casa +5000.
      const balAfter = Number(await getHouseBalance(ctx));
      expect(balAfter).toBeCloseTo(balBefore + 5000, 2);
    });

    it('GET /mint-budget refleja lo minteado este mes', async () => {
      await setBudget(2000);

      // Estado inicial: nada minteado (beforeEach limpió injections).
      const before = await ctx.request
        .get('/tenant/house/mint-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(before.status).toBe(200);
      const b0 = before.body as {
        monthlyBudget: string;
        mintedThisMonth: string;
        available: string;
      };
      expect(b0.monthlyBudget).toBe('2000.00');
      expect(b0.mintedThisMonth).toBe('0.00');
      expect(b0.available).toBe('2000.00');

      // Fondeamos 750.
      await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '750',
          reason: 'mint budget status',
          idempotencyKey: freshKey('cap-status'),
        });

      const after = await ctx.request
        .get('/tenant/house/mint-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const b1 = after.body as {
        monthlyBudget: string;
        mintedThisMonth: string;
        available: string;
      };
      expect(b1.monthlyBudget).toBe('2000.00');
      expect(b1.mintedThisMonth).toBe('750.00');
      expect(b1.available).toBe('1250.00');
    });

    it('fondeo (que excede) suma a mintedThisMonth del status', async () => {
      await setBudget(100);
      await ctx.request
        .post('/tenant/house/inject-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          amount: '1000',
          reason: 'fondeo contable',
          fondeo: true,
          idempotencyKey: freshKey('cap-fondeo-status'),
        });

      const res = await ctx.request
        .get('/tenant/house/mint-budget')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const b = res.body as { mintedThisMonth: string; available: string };
      // El fondeo cuenta como minteado (es type='budget'). Como excede el
      // tope, available cae a 0 (clamp).
      expect(b.mintedThisMonth).toBe('1000.00');
      expect(b.available).toBe('0.00');
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
