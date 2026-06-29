/**
 * E2E: LedgerController — validador de invariante del ledger (Blindaje, Parte A).
 *
 * Cubre el corazón del feature: que el chequeo detecte un saldo tocado POR
 * FUERA del ledger (el escenario del "+1M por SQL") y que vuelva a dar OK al
 * revertirlo. Más: supply, historial, y el gate de permiso (un cajero sin
 * `ledger.view` recibe 403).
 *
 * Estrategia: minteamos una wallet consistente (todo vía WalletService, así
 * cuadra), la perturbamos con un UPDATE directo a `wallets.balance` sin tx, y
 * verificamos que el validador la marca con la diferencia exacta. El UPDATE se
 * revierte en `finally` para no dejar el tenant de test sucio.
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';

interface Mismatch {
  walletId: string;
  kind: 'balance' | 'locked';
  stored: string;
  ledger: string;
  diff: string;
}

interface Run {
  id: string;
  status: 'ok' | 'mismatch' | 'error';
  walletsChecked: number;
  walletsMismatched: number;
  holdsMismatched: number;
  mismatches: { items: Mismatch[]; truncated: number } | null;
  supply: Record<string, string> | null;
}

/** Devuelve la wallet a la que apuntó la tx con esa idempotency-key. */
async function getWalletByMintKey(
  key: string,
): Promise<{ id: string; balance: string }> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ id: string; balance: string }[]>`
      SELECT w.id, w.balance::text AS balance
      FROM wallets w
      JOIN wallet_transactions wt ON wt.wallet_id = w.id
      WHERE wt.idempotency_key = ${key}
      LIMIT 1
    `;
    return rows[0]!;
  } finally {
    await sql.end();
  }
}

/** Toca el saldo de una wallet DIRECTAMENTE, sin pasar por el ledger. */
async function bumpBalance(walletId: string, delta: string): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql`UPDATE wallets SET balance = balance + ${delta}::numeric WHERE id = ${walletId}`;
  } finally {
    await sql.end();
  }
}

describe('LedgerController — reconciliación de invariante (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let walletId: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    // Minteamos para garantizar una wallet consistente que podamos perturbar.
    const mintKey = `ledger-e2e-mint-${Date.now()}`;
    const r = await ctx.request
      .post('/tenant/wallet/mint')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', mintKey)
      .send({ amount: '1000.00', reason: 'seed para test de ledger' });
    expect(r.status).toBe(201);

    walletId = (await getWalletByMintKey(mintKey)).id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function reconcile(): Promise<Run> {
    const r = await ctx.request
      .post('/tenant/ledger/reconcile')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({});
    expect(r.status).toBe(200);
    return r.body as Run;
  }

  it('en estado consistente, la wallet minteada cuadra', async () => {
    const run = await reconcile();
    expect(run.walletsChecked).toBeGreaterThan(0);
    const mine = run.mismatches?.items.find((m) => m.walletId === walletId);
    expect(mine).toBeUndefined();
  });

  it('detecta un saldo tocado por fuera del ledger y vuelve a cuadrar al revertir', async () => {
    await bumpBalance(walletId, '123456.78');
    try {
      const run = await reconcile();
      expect(run.status).toBe('mismatch');
      const mine = run.mismatches?.items.find(
        (m) => m.walletId === walletId && m.kind === 'balance',
      );
      expect(mine).toBeDefined();
      // stored − ledger = exactamente lo que inyectamos.
      expect(mine!.diff).toBe('123456.78');
    } finally {
      await bumpBalance(walletId, '-123456.78');
    }

    const after = await reconcile();
    const mine = after.mismatches?.items.find((m) => m.walletId === walletId);
    expect(mine).toBeUndefined();
  });

  it('GET /supply devuelve el snapshot de fichas', async () => {
    const r = await ctx.request
      .get('/tenant/ledger/supply')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(r.status).toBe(200);
    const body = r.body as Record<string, string>;
    expect(body).toHaveProperty('totalMinted');
    expect(body).toHaveProperty('circulating');
    expect(body).toHaveProperty('netLedger');
  });

  it('GET /reconciliations devuelve historial y latest', async () => {
    const list = await ctx.request
      .get('/tenant/ledger/reconciliations')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(list.status).toBe(200);
    expect((list.body as { runs: unknown[] }).runs.length).toBeGreaterThan(0);

    const latest = await ctx.request
      .get('/tenant/ledger/reconciliations/latest')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(latest.status).toBe(200);
    expect((latest.body as { run: unknown }).run).toBeTruthy();
  });

  it('un cajero sin ledger.view recibe 403', async () => {
    const cajero = await createTestUser(ctx.request, adminToken, {
      suite: 'ledger',
      label: 'cajero',
      role: 'cajero',
    });
    const token = await loginAs(ctx.request, cajero.username, cajero.password);
    const r = await ctx.request
      .get('/tenant/ledger/reconciliations')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token);
    expect(r.status).toBe(403);
  });
});
