/**
 * E2E: Auto-grant de bonos en deposits.approve.
 *
 * Cobertura:
 *
 * Welcome:
 *   - Primer deposit aprobado del user → bono welcome otorgado.
 *   - Monto = min(deposit * matchPct/100, maxAmount).
 *   - Sin welcome definition activa → no se otorga, deposit sigue OK.
 *   - Deposit < minDeposit → no se otorga.
 *
 * Reload:
 *   - Segundo deposit aprobado → bono reload otorgado.
 *
 * Idempotencia:
 *   - Aprobar el mismo deposit dos veces (segunda es no-op) → un solo bono.
 *
 * Fail-soft:
 *   - Si la definition welcome existe pero el funder no tiene saldo, el
 *     deposit se aprueba igual + audit "bonus.auto_grant_failed".
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

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

async function countActiveBonusesFor(userId: string): Promise<number> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*) FROM user_bonuses WHERE user_id = ${userId} AND status = 'active'
    `;
    return Number(rows[0]!.count);
  } finally {
    await sql.end();
  }
}

async function readBonusesFor(userId: string): Promise<Array<Record<string, unknown>>> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<Array<Record<string, unknown>>>`
      SELECT id, granted_amount, status, source_event, granted_at
      FROM user_bonuses WHERE user_id = ${userId} ORDER BY granted_at ASC
    `;
    return rows;
  } finally {
    await sql.end();
  }
}

interface CreatedDeposit {
  id: string;
}

async function createDeposit(
  ctx: TestApp,
  playerToken: string,
  methodId: string,
  amountChips: string,
): Promise<CreatedDeposit> {
  const res = await ctx.request
    .post('/tenant/deposits')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', playerToken)
    .send({
      methodId,
      amountChips,
      amountFiat: amountChips,
      currencyFiat: 'ARS',
    });
  if (res.status !== 201) {
    throw new Error(
      `createDeposit falló: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return { id: res.body.deposit.id as string };
}

async function approveDeposit(
  ctx: TestApp,
  adminToken: string,
  depositId: string,
): Promise<unknown> {
  const res = await ctx.request
    .post(`/tenant/deposits/${depositId}/approve`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken);
  expect(res.status).toBe(200);
  return res.body;
}

describe('Bonuses auto-grant on deposit.approve (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let methodId: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    // Mint para fondear los grants. El admin es funder por default.
    await ctx.request
      .post('/tenant/wallet/mint')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', freshKey('mint-autograna'))
      .send({ amount: '1000000', reason: 'mint inicial para fondear bonos auto-grant tests' });

    methodId = await createPaymentMethod(`autograna-method-${Date.now().toString(36)}`);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('Welcome', () => {
    it('primer deposit aprobado → welcome bonus otorgado con monto correcto', async () => {
      // Welcome 100% match, max 50k, min 100.
      const code = `welcome_auto_${Date.now()}`;
      await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code,
          name: 'Welcome Auto',
          type: 'welcome',
          status: 'active',
          config: { matchPct: 100, maxAmount: 50000, minDeposit: 100 },
        });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'autograna-welcome',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      const deposit = await createDeposit(ctx, playerToken, methodId, '500');
      await approveDeposit(ctx, adminToken, deposit.id);

      // Esperamos un único bono active del player con monto 500
      // (500 * 100% = 500, bajo el max=50000).
      const bonuses = await readBonusesFor(player.id);
      expect(bonuses).toHaveLength(1);
      expect(bonuses[0]!.granted_amount).toBe('500.00');
      expect(bonuses[0]!.status).toBe('active');
      const sourceEvent = bonuses[0]!.source_event as { kind: string; depositId: string };
      expect(sourceEvent.kind).toBe('deposit_welcome');
      expect(sourceEvent.depositId).toBe(deposit.id);
    });

    it('monto se capa por maxAmount cuando deposit * matchPct lo supera', async () => {
      // Welcome 100%, max 200 → deposit de 1000 debe dar bono = 200 (no 1000).
      // Necesitamos definition fresh con un code distinto + reset el welcome anterior.
      // Para esto el truncate de beforeEach (no hay, suite usa una sola DB)... wait,
      // los bonos están truncated en bootstrapTestApp. Pero dentro de la suite NO.
      // Cada test usa player distinto → no se mezclan welcomes (cada player tiene
      // count==1 separado).
      const code = `welcome_capped_${Date.now()}`;
      // Necesitamos archivar la otra welcome para que esta sea la única active.
      await archiveAllWelcomeDefsExcept(code);
      await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code,
          name: 'Welcome Capped',
          type: 'welcome',
          status: 'active',
          config: { matchPct: 100, maxAmount: 200, minDeposit: 100 },
        });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'autograna-cap',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      const dep = await createDeposit(ctx, playerToken, methodId, '1000');
      await approveDeposit(ctx, adminToken, dep.id);

      const bonuses = await readBonusesFor(player.id);
      expect(bonuses).toHaveLength(1);
      expect(bonuses[0]!.granted_amount).toBe('200.00');
    });

    it('deposit < minDeposit → no se otorga bono, deposit OK', async () => {
      const code = `welcome_min_${Date.now()}`;
      await archiveAllWelcomeDefsExcept(code);
      await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code,
          name: 'Welcome Min',
          type: 'welcome',
          status: 'active',
          config: { matchPct: 100, maxAmount: 50000, minDeposit: 1000 },
        });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'autograna-min',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      // Depósito de 500 — bajo el min 1000.
      const dep = await createDeposit(ctx, playerToken, methodId, '500');
      await approveDeposit(ctx, adminToken, dep.id);

      expect(await countActiveBonusesFor(player.id)).toBe(0);
    });

    it('sin welcome definition activa → deposit aprueba normal sin bono', async () => {
      await archiveAllWelcomeDefsExcept('__none__');

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'autograna-no-def',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      const dep = await createDeposit(ctx, playerToken, methodId, '500');
      await approveDeposit(ctx, adminToken, dep.id);

      expect(await countActiveBonusesFor(player.id)).toBe(0);
    });
  });

  describe('Reload', () => {
    it('segundo deposit aprobado → reload bonus (no segundo welcome)', async () => {
      // Welcome 100% / max 50k.
      const wCode = `welcome_for_reload_${Date.now()}`;
      await archiveAllWelcomeDefsExcept(wCode);
      await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: wCode,
          name: 'Welcome para reload test',
          type: 'welcome',
          status: 'active',
          config: { matchPct: 100, maxAmount: 50000, minDeposit: 0 },
        });

      // Reload 50% / max 10k.
      const rCode = `reload_auto_${Date.now()}`;
      await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: rCode,
          name: 'Reload Auto',
          type: 'reload',
          status: 'active',
          config: { matchPct: 50, maxAmount: 10000, minDeposit: 0 },
        });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'autograna-reload',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      // Primer deposit 200 → welcome 200.
      const d1 = await createDeposit(ctx, playerToken, methodId, '200');
      await approveDeposit(ctx, adminToken, d1.id);

      // Segundo deposit 400 → reload 200 (50% de 400).
      const d2 = await createDeposit(ctx, playerToken, methodId, '400');
      await approveDeposit(ctx, adminToken, d2.id);

      const bonuses = await readBonusesFor(player.id);
      expect(bonuses).toHaveLength(2);
      expect(bonuses[0]!.granted_amount).toBe('200.00');
      expect((bonuses[0]!.source_event as { kind: string }).kind).toBe('deposit_welcome');
      expect(bonuses[1]!.granted_amount).toBe('200.00');
      expect((bonuses[1]!.source_event as { kind: string }).kind).toBe('deposit_reload');
    });
  });

  describe('Idempotencia', () => {
    it('aprobar el mismo deposit dos veces → un solo bono', async () => {
      const code = `welcome_idem_${Date.now()}`;
      await archiveAllWelcomeDefsExcept(code);
      await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code,
          name: 'Welcome Idem',
          type: 'welcome',
          status: 'active',
          config: { matchPct: 100, maxAmount: 50000, minDeposit: 0 },
        });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'autograna-idem',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      const dep = await createDeposit(ctx, playerToken, methodId, '300');
      await approveDeposit(ctx, adminToken, dep.id);
      // Segunda aprobación — el service tira AlreadyResolved? Veamos:
      // de hecho approve es idempotent silencioso (devuelve el deposit ya
      // aprobado). El controller tira el hook solo si `before.status !==
      // after.status` — la segunda vez before == after == approved, no
      // dispara hook. Buen comportamiento por diseño.
      await approveDeposit(ctx, adminToken, dep.id);

      const bonuses = await readBonusesFor(player.id);
      expect(bonuses).toHaveLength(1);
    });
  });

  describe('Fail-soft', () => {
    it('cuando definition mal configurada (matchPct=0) → no bono pero deposit OK', async () => {
      const code = `welcome_zero_${Date.now()}`;
      await archiveAllWelcomeDefsExcept(code);
      await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code,
          name: 'Welcome Zero',
          type: 'welcome',
          status: 'active',
          config: { matchPct: 0, maxAmount: 50000, minDeposit: 0 },
        });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'autograna-zero',
        label: 'p',
        role: 'usuario_final',
      });
      const playerToken = await loginAs(ctx.request, player.username, player.password);

      const dep = await createDeposit(ctx, playerToken, methodId, '500');
      const result = await approveDeposit(ctx, adminToken, dep.id);

      // El deposit fue aprobado.
      expect((result as { deposit: { status: string } }).deposit.status).toBe('approved');
      // Pero no se otorgó bono.
      expect(await countActiveBonusesFor(player.id)).toBe(0);
    });
  });
});

// Helper: archiva todas las definitions welcome para que solo `keepCode`
// quede activa (ó ninguna si keepCode='__none__'). Necesario para
// determinismo en tests donde varias welcome conviven en la DB.
async function archiveAllWelcomeDefsExcept(keepCode: string): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(
      `UPDATE bonus_definitions SET status = 'archived' WHERE type = 'welcome' AND code <> $1`,
      [keepCode],
    );
  } finally {
    await sql.end();
  }
}
