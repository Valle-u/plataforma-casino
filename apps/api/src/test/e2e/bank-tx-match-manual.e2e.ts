/**
 * E2E: conciliación de CARGAS/RETIROS manuales con transferencias bancarias.
 *
 * Verifica el nuevo BankTransactionsService.matchManual / listUnmatchedManual y
 * la migración 0093 (bank_transactions.matched_manual_tx_id + índice único):
 *   - Matchea una carga (incoming ↔ load) y marca la transferencia usada.
 *   - No se puede reusar una transferencia ya matcheada.
 *   - Rechaza dirección incorrecta (incoming vs unload).
 *   - Rechaza monto distinto sin override; acepta con override + motivo.
 *   - unmatch libera la transferencia (se puede re-conciliar).
 *   - listUnmatchedManual excluye las cargas ya conciliadas.
 */

import { sql } from 'drizzle-orm';
import { loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';
import { BankTransactionsService } from '../../bank-transactions/bank-transactions.service';

type Row = Record<string, string>;
const rows = (r: unknown): Row[] => r as unknown as Row[];

describe('BankTransactions — conciliar cargas/retiros manuales (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let adminId: string;
  let svc: BankTransactionsService;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    const a = await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username} LIMIT 1`,
    );
    adminId = rows(a)[0]!.id;
    svc = ctx.app.get(BankTransactionsService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function mkPlayer(label: string) {
    return createTestUser(ctx.request, adminToken, {
      suite: 'bank-match',
      label,
      role: 'usuario_final',
    });
  }

  async function mkBankTx(amount: number, direction: 'incoming' | 'outgoing'): Promise<string> {
    const r = await ctx.tenantDb.execute(
      sql`INSERT INTO bank_transactions
            (id, amount, currency, received_at, status, direction, uploaded_by)
          VALUES
            (gen_random_uuid(), ${amount.toFixed(2)}, 'ARS', now(), 'unmatched',
             ${direction}, ${adminId})
          RETURNING id`,
    );
    return rows(r)[0]!.id;
  }

  async function mkManualTx(userId: string, type: 'load' | 'unload', amount: number): Promise<string> {
    await ctx.tenantDb.execute(
      sql`INSERT INTO wallets (id, user_id, balance)
          VALUES (gen_random_uuid(), ${userId}, '0')
          ON CONFLICT (user_id) DO NOTHING`,
    );
    const w = await ctx.tenantDb.execute(
      sql`SELECT id FROM wallets WHERE user_id = ${userId} LIMIT 1`,
    );
    const walletId = rows(w)[0]!.id;
    const r = await ctx.tenantDb.execute(
      sql`INSERT INTO wallet_transactions
            (id, wallet_id, type, amount, balance_after, source, reason, created_at)
          VALUES
            (gen_random_uuid(), ${walletId}, ${type}, ${amount.toFixed(2)},
             ${amount.toFixed(2)}, 'load_flow', 'carga manual test', now())
          RETURNING id`,
    );
    return rows(r)[0]!.id;
  }

  it('matchea una carga (incoming ↔ load) y bloquea el reuso', async () => {
    const p = await mkPlayer('p1');
    const bankTx = await mkBankTx(5000, 'incoming');
    const loadTx = await mkManualTx(p.id, 'load', 5000);

    const matched = await svc.matchManual(ctx.tenantDb, bankTx, loadTx, adminId, {});
    expect(matched.status).toBe('matched');
    expect(matched.matchedManualTxId).toBe(loadTx);

    // La misma transferencia no se puede reusar con otra carga.
    const loadTx2 = await mkManualTx(p.id, 'load', 5000);
    await expect(
      svc.matchManual(ctx.tenantDb, bankTx, loadTx2, adminId, {}),
    ).rejects.toThrow();
  });

  it('rechaza dirección incorrecta (incoming vs unload)', async () => {
    const p = await mkPlayer('p2');
    const bankTx = await mkBankTx(1000, 'incoming');
    const unloadTx = await mkManualTx(p.id, 'unload', 1000);
    await expect(
      svc.matchManual(ctx.tenantDb, bankTx, unloadTx, adminId, {}),
    ).rejects.toThrow();
  });

  it('rechaza monto distinto sin override; acepta con override + motivo', async () => {
    const p = await mkPlayer('p3');
    const bankTx = await mkBankTx(1000, 'incoming');
    const loadTx = await mkManualTx(p.id, 'load', 900);
    await expect(
      svc.matchManual(ctx.tenantDb, bankTx, loadTx, adminId, {}),
    ).rejects.toThrow();
    const matched = await svc.matchManual(ctx.tenantDb, bankTx, loadTx, adminId, {
      override: true,
      overrideReason: 'diferencia menor por redondeo',
    });
    expect(matched.status).toBe('matched');
  });

  it('unmatch libera la transferencia y permite re-conciliar', async () => {
    const p = await mkPlayer('p4');
    const bankTx = await mkBankTx(2000, 'incoming');
    const loadTx = await mkManualTx(p.id, 'load', 2000);
    await svc.matchManual(ctx.tenantDb, bankTx, loadTx, adminId, {});
    const un = await svc.unmatch(ctx.tenantDb, bankTx, adminId);
    expect(un.status).toBe('unmatched');
    expect(un.matchedManualTxId).toBeNull();
    const re = await svc.matchManual(ctx.tenantDb, bankTx, loadTx, adminId, {});
    expect(re.status).toBe('matched');
  });

  it('listUnmatchedManual excluye las cargas ya conciliadas', async () => {
    const p = await mkPlayer('p5');
    const loadA = await mkManualTx(p.id, 'load', 7777);
    const loadB = await mkManualTx(p.id, 'load', 7777);
    const bankTx = await mkBankTx(7777, 'incoming');
    await svc.matchManual(ctx.tenantDb, bankTx, loadA, adminId, {});

    const list = await svc.listUnmatchedManual(ctx.tenantDb, 'incoming', {
      amount: '7777.00',
    });
    const ids = list.map((r) => r.id);
    expect(ids).toContain(loadB);
    expect(ids).not.toContain(loadA);
  });
});
