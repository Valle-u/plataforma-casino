/**
 * E2E: Job de expiración de bonos.
 *
 * Disparado en tests vía `POST /tenant/bonuses/jobs/expire` (endpoint que
 * llama a `BonusesExpirationService.expireDueForTenant`). El cron real
 * está deshabilitado en tests via env `BONUSES_EXPIRE_ENABLED=false`.
 *
 * Cobertura:
 *
 * Caso happy:
 *   - Bono active con `expires_at` en el pasado → job lo marca expired,
 *     remainingAmount=0, fichas vuelven al funder.
 *
 * No-op:
 *   - Bono active con `expires_at` futuro → sigue active.
 *   - Bono ya cancelled/cleared → ignorado.
 *
 * Idempotencia:
 *   - Llamar el job dos veces → segundo run no encuentra nada (no double
 *     revert al funder).
 *
 * Permisos:
 *   - Endpoint requiere `bonuses.force_clear` (admin only).
 *
 * Audit:
 *   - Cada bono procesado genera entry `bonus.expired`.
 *   - Run con totalProcessed > 0 genera entry `bonus.expire_job.manual`.
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';
import { fundWalletForTests } from '../helpers/fund-wallet';

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readBonus(id: string): Promise<Record<string, unknown> | null> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT * FROM user_bonuses WHERE id = ${id}
    `;
    return rows[0] ?? null;
  } finally {
    await sql.end();
  }
}

async function readWalletBalance(userId: string): Promise<string> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ balance: string }[]>`
      SELECT balance FROM wallets WHERE user_id = ${userId}
    `;
    return rows[0]?.balance ?? '0';
  } finally {
    await sql.end();
  }
}

/**
 * Mueve `expires_at` de un bono al pasado para forzar elegibilidad en
 * el job. SQL directo porque la API no permite editar expiresAt (la
 * intención es que sea inmutable).
 */
async function forceExpiresAtInPast(bonusId: string, daysAgo = 1): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(
      `UPDATE user_bonuses SET expires_at = NOW() - ($1::int * INTERVAL '1 day') WHERE id = $2`,
      [daysAgo, bonusId],
    );
  } finally {
    await sql.end();
  }
}

async function countAuditByAction(actionCode: string): Promise<number> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*) FROM audit_log WHERE action_code = ${actionCode}
    `;
    return Number(rows[0]!.count);
  } finally {
    await sql.end();
  }
}

describe('Bonuses expiration job (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let adminUserId: string;
  let cajero1Token: string;
  let definitionId: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    const me = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    adminUserId = (me.body as { user: { id: string } }).user.id;

    // Fondeo para los grants.
    await fundWalletForTests(adminUserId, '500000');

    cajero1Token = await loginAsCajero1(ctx.request);

    // Definition única para la suite — usamos manual para no tocar lógica
    // de auto-grant (que filtraría por welcome/reload).
    const def = await ctx.request
      .post('/tenant/bonus-definitions')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        code: `expir_test_${Date.now()}`,
        name: 'Expir Test',
        type: 'manual',
        status: 'active',
        expirationDays: 30,
      });
    expect(def.status).toBe(201);
    definitionId = def.body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function grantBonus(amount: string, targetUserId: string): Promise<string> {
    const res = await ctx.request
      .post('/tenant/bonuses/grant')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', freshKey('grant-expir'))
      .send({
        userId: targetUserId,
        definitionId,
        amount,
        reason: `grant inicial para test de expiration ${Date.now()}`,
      });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  describe('Happy path', () => {
    it('bono active con expires_at pasado → expired + revert al funder', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'expir-happy',
        label: 'p',
        role: 'usuario_final',
      });
      const bonusId = await grantBonus('500', player.id);
      const balanceAfterGrant = await readWalletBalance(adminUserId);

      await forceExpiresAtInPast(bonusId);

      const run = await ctx.request
        .post('/tenant/bonuses/jobs/expire')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(run.status).toBe(200);
      expect(run.body.succeeded).toBeGreaterThanOrEqual(1);
      expect(run.body.failed).toBe(0);

      const bonus = await readBonus(bonusId);
      expect(bonus).not.toBeNull();
      expect(bonus!.status).toBe('expired');
      expect(bonus!.remaining_amount).toBe('0.00');

      const balanceAfterExpire = await readWalletBalance(adminUserId);
      expect(Number(balanceAfterExpire) - Number(balanceAfterGrant)).toBe(500);

      // Audit "bonus.expired" debe haberse creado al menos 1 vez para
      // este bonus (y "bonus.expire_job.manual" 1 vez para el batch).
      expect(await countAuditByAction('bonus.expired')).toBeGreaterThanOrEqual(1);
      expect(await countAuditByAction('bonus.expire_job.manual')).toBeGreaterThanOrEqual(1);
    });
  });

  describe('No-op', () => {
    it('bono con expires_at futuro NO se procesa', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'expir-future',
        label: 'p',
        role: 'usuario_final',
      });
      const bonusId = await grantBonus('100', player.id);
      // No movemos expires_at → sigue futuro (30 días).

      const run = await ctx.request
        .post('/tenant/bonuses/jobs/expire')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(run.status).toBe(200);

      const bonus = await readBonus(bonusId);
      expect(bonus!.status).toBe('active');
    });

    it('bono ya cancelled NO se procesa', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'expir-cancelled',
        label: 'p',
        role: 'usuario_final',
      });
      const bonusId = await grantBonus('100', player.id);

      // Cancel primero.
      await ctx.request
        .post(`/tenant/bonuses/${bonusId}/cancel`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ reason: 'cancel previo para test de expiration ignore' });

      // Aunque movamos expires_at, no debería tocar el bono.
      await forceExpiresAtInPast(bonusId);
      await ctx.request
        .post('/tenant/bonuses/jobs/expire')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const bonus = await readBonus(bonusId);
      expect(bonus!.status).toBe('cancelled'); // sigue cancelled, no expired
    });
  });

  describe('Idempotencia', () => {
    it('correr el job dos veces sobre el mismo bono no duplica revert', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'expir-idem',
        label: 'p',
        role: 'usuario_final',
      });
      const bonusId = await grantBonus('200', player.id);

      await forceExpiresAtInPast(bonusId);

      const balanceBefore = await readWalletBalance(adminUserId);
      await ctx.request
        .post('/tenant/bonuses/jobs/expire')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const balanceAfterFirst = await readWalletBalance(adminUserId);

      const second = await ctx.request
        .post('/tenant/bonuses/jobs/expire')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      // El segundo run no encuentra el bono (ya status='expired').
      expect(second.body.totalProcessed).toBe(0);

      const balanceAfterSecond = await readWalletBalance(adminUserId);
      // Solo un revert: balance subió en 200 en el primer run, igual tras
      // el segundo run.
      expect(Number(balanceAfterFirst) - Number(balanceBefore)).toBe(200);
      expect(Number(balanceAfterSecond) - Number(balanceAfterFirst)).toBe(0);
    });
  });

  describe('Permisos', () => {
    it('cajero1 sin bonuses.force_clear → 403', async () => {
      const res = await ctx.request
        .post('/tenant/bonuses/jobs/expire')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });
  });

  describe('Batch con varios bonos', () => {
    it('procesa todos los vencidos en una sola corrida', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'expir-batch',
        label: 'p',
        role: 'usuario_final',
      });
      const ids = await Promise.all([
        grantBonus('50', player.id),
        grantBonus('60', player.id),
        grantBonus('70', player.id),
      ]);
      // Wait sequential to avoid wallet contention; here Promise.all OK
      // porque las 3 transacciones serializan sobre el funder wallet con
      // lock_timeout.

      for (const id of ids) {
        await forceExpiresAtInPast(id);
      }

      const balanceBefore = await readWalletBalance(adminUserId);
      const run = await ctx.request
        .post('/tenant/bonuses/jobs/expire')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(run.status).toBe(200);
      expect(run.body.totalProcessed).toBeGreaterThanOrEqual(3);
      expect(run.body.succeeded).toBeGreaterThanOrEqual(3);

      const balanceAfter = await readWalletBalance(adminUserId);
      // 50+60+70 = 180 vuelven al admin.
      expect(Number(balanceAfter) - Number(balanceBefore)).toBe(180);

      for (const id of ids) {
        const b = await readBonus(id);
        expect(b!.status).toBe('expired');
      }
    });
  });
});
