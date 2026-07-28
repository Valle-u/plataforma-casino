/**
 * E2E: unload network routing — dependiente → Casa, independiente → direct parent.
 *
 * The POST /tenant/wallet/unload endpoint resolves the destination for chips:
 *   - Dependent network (no independent branch ancestor): chips go to Casa.
 *   - Independent network (has independent branch ancestor): chips go to
 *     the direct parent (whoever loaded the chips, NOT the socio owner).
 *
 * ScopeGuard money-move isolation (MONEY_MOVE_BYPASS_PERMS):
 *   - Admin CANNOT unload from players in independent subtrees.
 *   - Only actors WITHIN the independent network can unload from its members.
 *
 * This suite validates the routing logic introduced in the unload endpoint,
 * covering both network topologies and audit metadata.
 */

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { HOUSE_USERNAME } from '@casino/db';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';
import { getTestTenantUrl } from '../setup/db-helpers';

interface TransferResponse {
  ok: true;
  sourceTransaction: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
  };
  targetTransaction: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
    relatedTxId: string | null;
  };
  sourceWallet: {
    id: string;
    userId: string;
    balance: string;
  };
  targetWallet: {
    id: string;
    userId: string;
    balance: string;
  };
}

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('Wallet unload — network routing (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    const me = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    adminId = (me.body as { user: { id: string } }).user.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ─── Helpers ──────────────────────────────────────────────────────

  async function setParent(childId: string, parentId: string): Promise<void> {
    const r = await ctx.request
      .put(`/tenant/user-hierarchy/${childId}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ parentUserId: parentId, relationType: 'jugador_de_cajero' });
    if (r.status !== 200 && r.status !== 201) {
      throw new Error(`setParent falló ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  async function makeIndependent(socioId: string, cbu: string): Promise<void> {
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

  async function getCasaBalance(): Promise<number> {
    const rows = (await ctx.tenantDb.execute(
      sql`SELECT w.balance FROM wallets w
          JOIN users u ON u.id = w.user_id
          WHERE u.username = ${HOUSE_USERNAME} LIMIT 1`,
    )) as unknown as Array<{ balance: string }>;
    return Number(rows[0]?.balance ?? 0);
  }

  async function getUserId(username: string): Promise<string> {
    const rows = (await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${username} LIMIT 1`,
    )) as unknown as Array<{ id: string }>;
    return rows[0]!.id;
  }

  async function grantPerm(userId: string, code: string): Promise<void> {
    await ctx.request
      .post('/tenant/permission-overrides/grant')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ userId, permissionCode: code });
  }

  // ─── Scenario 1: Dependent network → Casa ─────────────────────────

  describe('Dependent network — chips go to Casa', () => {
    it('unload from player under admin network → Casa receives chips, not the admin actor', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'unload-dep',
        label: 'player',
        role: 'cajero',
      });
      await setParent(player.id, adminId);
      await fundWalletForTests(player.id, '1000');

      const casaBalanceBefore = await getCasaBalance();

      const r = await ctx.request
        .post('/tenant/wallet/unload')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('unload-dep'))
        .send({
          targetUserId: player.id,
          amount: '300',
          reason: 'unload dependente test',
        });

      expect(r.status).toBe(201);
      const body = r.body as TransferResponse;

      expect(body.sourceTransaction.type).toBe('unload');
      expect(body.sourceTransaction.amount).toBe('300.00');
      expect(parseFloat(body.sourceWallet.balance)).toBeCloseTo(700, 2);

      // Destination is Casa.
      expect(body.targetTransaction.type).toBe('adjustment');
      const casaBalanceAfter = await getCasaBalance();
      expect(casaBalanceAfter).toBeCloseTo(casaBalanceBefore + 300, 2);

      const casaUserId = await getUserId(HOUSE_USERNAME);
      expect(body.targetWallet.userId).toBe(casaUserId);
    });

    it('audit metadata has destinationType=casa and destinationUserId=Casa', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'unload-dep-audit',
        label: 'player',
        role: 'cajero',
      });
      await setParent(player.id, adminId);
      await fundWalletForTests(player.id, '500');

      const key = freshKey('unload-dep-audit');
      const r = await ctx.request
        .post('/tenant/wallet/unload')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', key)
        .send({
          targetUserId: player.id,
          amount: '100',
          reason: 'unload dependente audit test',
        });
      expect(r.status).toBe(201);

      const audit = await ctx.request
        .get(
          `/tenant/audit-log?actionCode=wallet.unload&targetId=${player.id}&limit=5&order=desc`,
        )
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const entries = (audit.body as { entries: Array<{ metadata: Record<string, unknown> }> }).entries;
      const entry = entries[0]!;
      expect(entry.metadata.destinationType).toBe('casa');
      const casaUserId = await getUserId(HOUSE_USERNAME);
      expect(entry.metadata.destinationUserId).toBe(casaUserId);
    });
  });

  // ─── Scenario 2: Independent network → direct parent ──────────────
  //
  // ScopeGuard blocks admin from unloading players in independent subtrees
  // (MONEY_MOVE_BYPASS_PERMS isolation). The actor must be WITHIN the
  // independent network. We use the socio (who has wallet.unload via override)
  // as the actor.

  describe('Independent network — chips go to direct parent', () => {
    it('socio (independent) unloads from player → socio (direct parent) receives chips', async () => {
      const socio = await createTestUser(ctx.request, adminToken, {
        suite: 'unload-indep',
        label: 'socio',
        role: 'socio',
      });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'unload-indep',
        label: 'player',
        role: 'cajero',
      });

      await makeIndependent(socio.id, '0000000000000000000001');
      await setParent(player.id, socio.id);

      // Grant wallet.unload to socio so they can operate.
      await grantPerm(socio.id, 'wallet.unload');

      await fundWalletForTests(player.id, '1000');
      await fundWalletForTests(socio.id, '500');

      const socioToken = await loginAs(ctx.request, socio.username, `pwd-unload-indep-socio-2026`);
      const socioBalanceBefore = await getBalance(socio.id);

      const r = await ctx.request
        .post('/tenant/wallet/unload')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', socioToken)
        .set('Idempotency-Key', freshKey('unload-indep'))
        .send({
          targetUserId: player.id,
          amount: '200',
          reason: 'unload independente test',
        });

      expect(r.status).toBe(201);
      const body = r.body as TransferResponse;

      expect(body.sourceTransaction.type).toBe('unload');
      expect(body.sourceTransaction.amount).toBe('200.00');
      expect(parseFloat(body.sourceWallet.balance)).toBeCloseTo(800, 2);

      // Destination is the socio (direct parent).
      expect(body.targetTransaction.type).toBe('transfer_in');
      const socioBalanceAfter = await getBalance(socio.id);
      expect(socioBalanceAfter).toBeCloseTo(socioBalanceBefore + 200, 2);
      expect(body.targetWallet.userId).toBe(socio.id);
    });

    it('audit metadata has destinationType=independent_direct_parent', async () => {
      const socio = await createTestUser(ctx.request, adminToken, {
        suite: 'unload-indep-audit',
        label: 'socio',
        role: 'socio',
      });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'unload-indep-audit',
        label: 'player',
        role: 'cajero',
      });
      await makeIndependent(socio.id, '0000000000000000000002');
      await setParent(player.id, socio.id);
      await grantPerm(socio.id, 'wallet.unload');
      await fundWalletForTests(player.id, '500');

      const socioToken = await loginAs(ctx.request, socio.username, `pwd-unload-indep-audit-socio-2026`);
      const key = freshKey('unload-indep-audit');
      const r = await ctx.request
        .post('/tenant/wallet/unload')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', socioToken)
        .set('Idempotency-Key', key)
        .send({
          targetUserId: player.id,
          amount: '100',
          reason: 'unload independente audit test',
        });
      expect(r.status).toBe(201);

      const audit = await ctx.request
        .get(
          `/tenant/audit-log?actionCode=wallet.unload&targetId=${player.id}&limit=5&order=desc`,
        )
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const entries = (audit.body as { entries: Array<{ metadata: Record<string, unknown> }> }).entries;
      const entry = entries[0]!;
      expect(entry.metadata.destinationType).toBe('independent_direct_parent');
      expect(entry.metadata.destinationUserId).toBe(socio.id);
    });
  });

  // ─── Scenario 3: Deep independent hierarchy → direct parent (not socio) ──

  describe('Deep independent hierarchy — chips go to direct parent, not socio owner', () => {
    it('cajero within independent network unloads from player → cajero (direct parent) receives chips', async () => {
      // Setup: socio(independent) → cajero → player.
      const socio = await createTestUser(ctx.request, adminToken, {
        suite: 'unload-deep-indep',
        label: 'socio',
        role: 'socio',
      });
      const cajero = await createTestUser(ctx.request, adminToken, {
        suite: 'unload-deep-indep',
        label: 'cajero',
        role: 'cajero',
      });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'unload-deep-indep',
        label: 'player',
        role: 'cajero',
      });

      await makeIndependent(socio.id, '0000000000000000000003');
      await setParent(cajero.id, socio.id);
      await setParent(player.id, cajero.id);

      // Grant wallet.unload to cajero so they can operate on player.
      await grantPerm(cajero.id, 'wallet.unload');

      await fundWalletForTests(player.id, '1000');
      await fundWalletForTests(cajero.id, '500');

      const cajeroToken = await loginAs(ctx.request, cajero.username, `pwd-unload-deep-indep-cajero-2026`);
      const cajeroBalanceBefore = await getBalance(cajero.id);

      const r = await ctx.request
        .post('/tenant/wallet/unload')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken)
        .set('Idempotency-Key', freshKey('unload-deep-indep'))
        .send({
          targetUserId: player.id,
          amount: '250',
          reason: 'unload deep independente test',
        });

      expect(r.status).toBe(201);
      const body = r.body as TransferResponse;

      expect(body.sourceTransaction.type).toBe('unload');
      expect(body.sourceTransaction.amount).toBe('250.00');
      expect(parseFloat(body.sourceWallet.balance)).toBeCloseTo(750, 2);

      // Destination is the CAJERO (direct parent), NOT the socio.
      expect(body.targetTransaction.type).toBe('transfer_in');
      const cajeroBalanceAfter = await getBalance(cajero.id);
      expect(cajeroBalanceAfter).toBeCloseTo(cajeroBalanceBefore + 250, 2);
      expect(body.targetWallet.userId).toBe(cajero.id);
    });
  });

  // ─── Scenario 4: wallet_transactions source field ─────────────────

  describe('wallet_transactions source field', () => {
    it('dependent unload writes source=unload_dependent', async () => {
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'unload-src-dep',
        label: 'player',
        role: 'cajero',
      });
      await setParent(player.id, adminId);
      await fundWalletForTests(player.id, '500');

      const key = freshKey('unload-src-dep');
      await ctx.request
        .post('/tenant/wallet/unload')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', key)
        .send({
          targetUserId: player.id,
          amount: '50',
          reason: 'unload dependent source test',
        });

      const sql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        const rows = await sql<{ source: string; type: string }[]>`
          SELECT source, type::text FROM wallet_transactions
          WHERE idempotency_key = ${key}
          ORDER BY created_at ASC
        `;
        expect(rows.length).toBe(1);
        expect(rows[0]!.type).toBe('unload');
        expect(rows[0]!.source).toBe('unload_dependent');
      } finally {
        await sql.end();
      }
    });

    it('independent unload writes source=unload_independent', async () => {
      const socio = await createTestUser(ctx.request, adminToken, {
        suite: 'unload-src-indep',
        label: 'socio',
        role: 'socio',
      });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'unload-src-indep',
        label: 'player',
        role: 'cajero',
      });
      await makeIndependent(socio.id, '0000000000000000000004');
      await setParent(player.id, socio.id);
      await grantPerm(socio.id, 'wallet.unload');
      await fundWalletForTests(player.id, '500');

      const socioToken = await loginAs(ctx.request, socio.username, `pwd-unload-src-indep-socio-2026`);
      const key = freshKey('unload-src-indep');
      await ctx.request
        .post('/tenant/wallet/unload')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', socioToken)
        .set('Idempotency-Key', key)
        .send({
          targetUserId: player.id,
          amount: '50',
          reason: 'unload independent source test',
        });

      const sql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        const rows = await sql<{ source: string; type: string }[]>`
          SELECT source, type::text FROM wallet_transactions
          WHERE idempotency_key = ${key}
          ORDER BY created_at ASC
        `;
        expect(rows.length).toBe(1);
        expect(rows[0]!.type).toBe('unload');
        expect(rows[0]!.source).toBe('unload_independent');
      } finally {
        await sql.end();
      }
    });
  });

  // ─── Scenario 5: ScopeGuard isolation ─────────────────────────────

  describe('ScopeGuard money-move isolation', () => {
    it('admin gets 403 when trying to unload from player in independent subtree', async () => {
      const socio = await createTestUser(ctx.request, adminToken, {
        suite: 'unload-isolation',
        label: 'socio',
        role: 'socio',
      });
      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'unload-isolation',
        label: 'player',
        role: 'cajero',
      });
      await makeIndependent(socio.id, '0000000000000000000005');
      await setParent(player.id, socio.id);
      await fundWalletForTests(player.id, '500');

      const r = await ctx.request
        .post('/tenant/wallet/unload')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .set('Idempotency-Key', freshKey('unload-isolation'))
        .send({
          targetUserId: player.id,
          amount: '100',
          reason: 'unload isolation test',
        });

      expect(r.status).toBe(403);
      expect((r.body as { error: string }).error).toBe('OUT_OF_SCOPE');
    });
  });
});
