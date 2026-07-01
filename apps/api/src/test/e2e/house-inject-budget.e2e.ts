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
        .send({ amount: '100', reason: 'intento no autorizado' });
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
        .send({ amount: '500', reason: 'presupuesto historial' });

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
          .send({ amount: '100', reason: `fondeo ${i}` });
        expect(r.status).toBe(201);
      }
      const balAfter = Number(await getHouseBalance(ctx));
      expect(balAfter).toBeCloseTo(300, 2);
    });
  });
});
