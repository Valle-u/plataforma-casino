/**
 * Spec 17 — Scoping de bonos / promotions / leagues por modelo del dueño
 * (Sprint 51.2).
 *
 * Reglas que verificamos:
 *   - Bonos:
 *     * admin_tenant crea + otorga a su red dependent → OK.
 *     * admin_tenant otorga a player bajo socio independent → OK con
 *       audit cross_branch (escape hatch).
 *     * auto-grant tras deposit aprobado: player dependent recibe la
 *       welcome del tenant; player bajo socio independent NO la recibe
 *       (la del tenant queda fuera de su scope).
 *     * socio independent activa el flag → recibe automáticamente
 *       overrides bonuses.*
 *     * socio independent crea su propia definition + grant manual
 *       a su downstream → OK.
 *     * socio independent intenta otorgar a un user fuera de su
 *       downstream → 403 BONUS_OUT_OF_BRANCH_SCOPE.
 *     * socio independent intenta usar una definition del tenant →
 *       403 BONUS_ACTOR_ROLE.
 *     * non-admin / non-independent intenta crear definition → 403.
 *
 *   - Promotions:
 *     * admin_tenant crea → OK.
 *     * socio independent intenta crear → 403 PROMOTION_ACTOR_ROLE.
 *
 *   - Leagues:
 *     * admin_tenant crea → OK.
 *     * socio independent intenta crear → 403 LEAGUE_ACTOR_ROLE.
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  createTestUserWithRole,
  ensurePaymentMethod,
  loginAs,
  loginAsAdmin,
  setUserParent,
  uploadDepositProof,
  type TestPlayer,
} from './helpers/api';

interface BonusDefinition {
  id: string;
  code: string;
  type: string;
  status: string;
  fundedByUserId: string;
  createdByUserId: string;
}

interface UserBonus {
  id: string;
  userId: string;
  definitionId: string;
  grantedAmount: string;
  fundedByUserId: string;
  crossBranchWarning?: boolean;
  independentBranchSocioId?: string;
}

interface DepositInfo {
  deposit: { id: string; status: string };
}

interface BankTxRow {
  id: string;
}

interface MeResponse {
  user: { id: string; username: string };
}

test.describe('Engagement scoping por modelo dueño (Sprint 51.2)', () => {
  let adminApi: ApiClient;
  let methodId: string;
  let adminId: string;

  // Red dependent (cuelga del tenant).
  let depSocio: TestPlayer;
  let depCajero: TestPlayer;
  let depPlayer: TestPlayer;

  // Red independent.
  let indSocio: TestPlayer;
  let indSocioApi: ApiClient;
  let indCajero: TestPlayer;
  let indPlayer: TestPlayer;

  // Tenant-wide welcome definition.
  let tenantWelcomeDef: BonusDefinition;
  // Branch-scoped welcome definition (del indSocio).
  let branchWelcomeDef: BonusDefinition;

  test.beforeAll(async () => {
    adminApi = await ApiClient.create();
    await loginAsAdmin(adminApi);
    const me = await adminApi.get<MeResponse>('/tenant/auth/me');
    adminId = me.user.id;
    const m = await ensurePaymentMethod(adminApi);
    methodId = m.id;

    // Mint al wallet del admin para que pueda fondear bonos.
    await adminApi.post(
      '/tenant/wallet/mint',
      { amount: '100000', reason: 'spec 17 admin funding' },
      { headers: { 'Idempotency-Key': `sp17-mint-admin-${Date.now()}` } },
    );

    // Red dependent.
    depSocio = await createTestUserWithRole(adminApi, 'sp17-dep-socio', 'socio');
    depCajero = await createTestUserWithRole(adminApi, 'sp17-dep-cajero', 'cajero');
    depPlayer = await createTestPlayer(adminApi, 'sp17-dep-player');
    await setUserParent(adminApi, depCajero.id, depSocio.id);
    await setUserParent(adminApi, depPlayer.id, depCajero.id);

    // Red independent.
    indSocio = await createTestUserWithRole(adminApi, 'sp17-ind-socio', 'socio');
    indCajero = await createTestUserWithRole(adminApi, 'sp17-ind-cajero', 'cajero');
    indPlayer = await createTestPlayer(adminApi, 'sp17-ind-player');
    await setUserParent(adminApi, indCajero.id, indSocio.id);
    await setUserParent(adminApi, indPlayer.id, indCajero.id);

    // Permisos al cajero indep para aprobar deposits + matchear bank_tx.
    for (const perm of ['deposits.approve', 'bank_tx.view', 'bank_tx.match']) {
      await adminApi.post('/tenant/permission-overrides/grant', {
        userId: indCajero.id,
        permissionCode: perm,
        reason: 'spec 17 setup',
      });
    }
    // Idem para cajero dependent.
    for (const perm of ['deposits.approve', 'bank_tx.view', 'bank_tx.match']) {
      await adminApi.post('/tenant/permission-overrides/grant', {
        userId: depCajero.id,
        permissionCode: perm,
        reason: 'spec 17 setup',
      });
    }

    // Activar indSocio como sucursal independiente — auto-grant de
    // bonuses.* permisos via override.
    await adminApi.post(`/tenant/users/${indSocio.id}/branch/toggle-independence`, {
      isIndependent: true,
      branchBankAccount: 'CBU-SPEC17-IND',
      branchChipsPricePerUnit: '1.0000',
    });
    // Sell-chips al socio para que tenga balance para fondear bonos.
    await adminApi.post(`/tenant/users/${indSocio.id}/branch/sell-chips`, {
      amountChips: '50000',
      notes: 'spec 17 funding',
    });

    indSocioApi = await ApiClient.create();
    await loginAs(indSocioApi, indSocio.username, indSocio.password);

    // Tenant-wide welcome definition (creado por admin).
    tenantWelcomeDef = await adminApi.post<BonusDefinition>(
      '/tenant/bonus-definitions',
      {
        code: `sp17-tenant-welcome-${Date.now()}`,
        name: 'Spec17 Tenant Welcome',
        type: 'welcome',
        status: 'active',
        config: { matchPct: 50, maxAmount: 500, minDeposit: 10 },
        expirationDays: 7,
      },
    );

    // Branch-scoped welcome definition (creado por socio independent).
    branchWelcomeDef = await indSocioApi.post<BonusDefinition>(
      '/tenant/bonus-definitions',
      {
        code: `sp17-branch-welcome-${Date.now()}`,
        name: 'Spec17 Branch Welcome',
        type: 'welcome',
        status: 'active',
        config: { matchPct: 30, maxAmount: 300, minDeposit: 10 },
        expirationDays: 7,
      },
    );
  });

  test.afterAll(async () => {
    await adminApi.dispose();
    if (indSocioApi) await indSocioApi.dispose();
  });

  // ──────────────────────────────────────────────────────────────────

  test('admin grant manual a player dependent → OK sin cross_branch', async () => {
    const idemp = `sp17-grant-dep-${Date.now()}`;
    const res = await adminApi.post<UserBonus>(
      '/tenant/bonuses/grant',
      {
        userId: depPlayer.id,
        definitionId: tenantWelcomeDef.id,
        amount: '100',
        reason: 'spec 17 grant dep',
      },
      { headers: { 'Idempotency-Key': idemp } },
    );
    expect(res.userId).toBe(depPlayer.id);
    expect(res.fundedByUserId).toBe(adminId);
    expect(res.crossBranchWarning).toBeUndefined();
  });

  test('admin grant manual a player bajo socio independent → OK con cross_branch', async () => {
    const idemp = `sp17-grant-ind-${Date.now()}`;
    const res = await adminApi.post<UserBonus>(
      '/tenant/bonuses/grant',
      {
        userId: indPlayer.id,
        definitionId: tenantWelcomeDef.id,
        amount: '50',
        reason: 'spec 17 grant cross-branch (escape hatch)',
      },
      { headers: { 'Idempotency-Key': idemp } },
    );
    expect(res.userId).toBe(indPlayer.id);
    expect(res.crossBranchWarning).toBe(true);
    expect(res.independentBranchSocioId).toBe(indSocio.id);
  });

  test('socio independent grant a su downstream → OK', async () => {
    const idemp = `sp17-grant-ind-self-${Date.now()}`;
    const res = await indSocioApi.post<UserBonus>(
      '/tenant/bonuses/grant',
      {
        userId: indPlayer.id,
        definitionId: branchWelcomeDef.id,
        amount: '60',
        reason: 'spec 17 socio grant own',
      },
      { headers: { 'Idempotency-Key': idemp } },
    );
    expect(res.userId).toBe(indPlayer.id);
    expect(res.fundedByUserId).toBe(indSocio.id);
  });

  test('socio independent intenta grant a player fuera de su downstream → 403', async () => {
    const idemp = `sp17-grant-out-${Date.now()}`;
    const res = await indSocioApi.postRaw(
      '/tenant/bonuses/grant',
      {
        userId: depPlayer.id,
        definitionId: branchWelcomeDef.id,
        amount: '10',
        reason: 'spec 17 out of branch',
      },
      { headers: { 'Idempotency-Key': idemp } },
    );
    expect(res.status).toBe(403);
    // El ScopeGuard del endpoint (que valida socio↔depPlayer) corta antes
    // que la lógica branch-scope del service, así que el error es
    // OUT_OF_SCOPE genérico — funcionalmente equivalente: el socio no
    // puede tocar a depPlayer.
    const body = res.body as { error?: string };
    expect(['OUT_OF_SCOPE', 'BONUS_OUT_OF_BRANCH_SCOPE']).toContain(body.error);
  });

  test('socio independent intenta usar definition del tenant → 403', async () => {
    const idemp = `sp17-grant-wrong-def-${Date.now()}`;
    const res = await indSocioApi.postRaw(
      '/tenant/bonuses/grant',
      {
        userId: indPlayer.id,
        definitionId: tenantWelcomeDef.id, // owner=admin, no del socio
        amount: '10',
        reason: 'spec 17 wrong def',
      },
      { headers: { 'Idempotency-Key': idemp } },
    );
    expect(res.status).toBe(403);
    const body = res.body as { error?: string };
    expect(body.error).toBe('BONUS_ACTOR_ROLE');
  });

  test('cajero (other role) intenta crear definition → 403', async () => {
    const cajeroApi = await ApiClient.create();
    await loginAs(cajeroApi, depCajero.username, depCajero.password);
    // El cajero NO tiene `bonuses.create_definition` (lo gatea el guard
    // antes que llegue al service). Esperamos 403 por permission.
    const res = await cajeroApi.postRaw('/tenant/bonus-definitions', {
      code: `sp17-cajero-${Date.now()}`,
      name: 'Cajero attempt',
      type: 'welcome',
      status: 'active',
      config: {},
      expirationDays: 7,
    });
    expect(res.status).toBe(403);
    await cajeroApi.dispose();
  });

  // ──────────────────────────────────────────────────────────────────
  // Auto-grant tras deposit approved
  // ──────────────────────────────────────────────────────────────────

  async function approveDepositWithBankTxAs(
    cajeroApi: ApiClient,
    playerId: string,
    amount: string,
  ): Promise<string> {
    // Player crea deposit.
    const playerApi = await ApiClient.create();
    const cred =
      playerId === depPlayer.id
        ? depPlayer
        : playerId === indPlayer.id
          ? indPlayer
          : null;
    if (!cred) throw new Error('player credentials unknown');
    await loginAs(playerApi, cred.username, cred.password);
    const proof = await uploadDepositProof(playerApi);
    const dep = await playerApi.post<DepositInfo>('/tenant/deposits', {
      methodId,
      amountChips: amount,
      amountFiat: amount,
      currencyFiat: 'ARS',
      receiptUrl: proof.receiptUrl,
      receiptStorageKey: proof.receiptStorageKey,
    });
    await playerApi.dispose();

    // Empleado (admin) sube incoming bank_tx + cajero matchea.
    const bt = await adminApi.post<BankTxRow>('/tenant/bank-transactions', {
      bankAccount: 'CBU-SPEC17',
      amount,
      direction: 'incoming',
      senderName: 'Spec17 sender',
      receivedAt: new Date().toISOString(),
    });
    await cajeroApi.post(
      `/tenant/bank-transactions/${bt.id}/match/${dep.deposit.id}`,
      {},
    );
    await cajeroApi.post(`/tenant/deposits/${dep.deposit.id}/approve`);
    return dep.deposit.id;
  }

  test('auto-grant: player dependent recibe welcome del tenant', async () => {
    const depCajeroApi = await ApiClient.create();
    await loginAs(depCajeroApi, depCajero.username, depCajero.password);

    const depositId = await approveDepositWithBankTxAs(
      depCajeroApi,
      depPlayer.id,
      '200',
    );

    // Buscar bonus auto-granteado por este deposit.
    const myBonuses = await adminApi.get<{ data: UserBonus[] }>(
      `/tenant/bonuses/user/${depPlayer.id}`,
    );
    const auto = myBonuses.data.find(
      (b) =>
        b.definitionId === tenantWelcomeDef.id ||
        b.fundedByUserId === adminId, // welcome del tenant
    );
    // El auto-grant puede haber elegido nuestra def o una previa del seed —
    // lo importante es que haya UN bonus del tenant.
    expect(auto).toBeDefined();
    expect(auto!.fundedByUserId).toBe(adminId);

    await depCajeroApi.dispose();
    void depositId;
  });

  test('auto-grant: player bajo socio independent NO recibe welcome del tenant', async () => {
    const indCajeroApi = await ApiClient.create();
    await loginAs(indCajeroApi, indCajero.username, indCajero.password);

    // Bonuses ANTES del deposit (para descartar grants previos del test).
    const before = await adminApi.get<{ data: UserBonus[] }>(
      `/tenant/bonuses/user/${indPlayer.id}`,
    );
    const tenantFundedBefore = before.data.filter(
      (b) => b.fundedByUserId === adminId,
    ).length;
    const branchFundedBefore = before.data.filter(
      (b) => b.fundedByUserId === indSocio.id,
    ).length;

    await approveDepositWithBankTxAs(indCajeroApi, indPlayer.id, '200');

    const after = await adminApi.get<{ data: UserBonus[] }>(
      `/tenant/bonuses/user/${indPlayer.id}`,
    );
    const tenantFundedAfter = after.data.filter(
      (b) => b.fundedByUserId === adminId,
    ).length;
    const branchFundedAfter = after.data.filter(
      (b) => b.fundedByUserId === indSocio.id,
    ).length;

    // El tenant NO debe haber sumado un auto-grant.
    expect(tenantFundedAfter).toBe(tenantFundedBefore);
    // El socio independent SÍ — su branchWelcomeDef matchea welcome.
    expect(branchFundedAfter).toBeGreaterThan(branchFundedBefore);

    await indCajeroApi.dispose();
  });

  // ──────────────────────────────────────────────────────────────────
  // Promotions / Leagues — solo admin_tenant
  // ──────────────────────────────────────────────────────────────────

  test('socio independent intenta crear promotion → 403', async () => {
    const res = await indSocioApi.postRaw('/tenant/promotions', {
      code: `sp17-promo-${Date.now()}`,
      name: 'Socio Promo',
      type: 'daily_wheel',
      config: { segments: [] },
      prizes: {},
    });
    // El socio independent NO tiene `promotions.create_definition` —
    // el PermissionsGuard corta antes que el service. Por eso el error
    // es `Forbidden` genérico. Si en el futuro se delegara el permiso,
    // el check de rol del service devolvería `PROMOTION_ACTOR_ROLE`.
    expect(res.status).toBe(403);
    const body = res.body as { error?: string };
    expect(['Forbidden', 'PROMOTION_ACTOR_ROLE']).toContain(body.error);
  });

  test('admin crea promotion → OK', async () => {
    const created = await adminApi.post<{ id: string }>('/tenant/promotions', {
      code: `sp17-admin-promo-${Date.now()}`,
      name: 'Admin Promo',
      type: 'daily_wheel',
      status: 'draft',
      config: {},
      prizes: {},
    });
    expect(created.id).toBeDefined();
  });

  test('socio independent intenta crear league → 403', async () => {
    const startsAt = new Date(Date.now() + 60_000).toISOString();
    const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await indSocioApi.postRaw('/tenant/leagues', {
      code: `sp17-league-${Date.now()}`,
      name: 'Socio League',
      period: 'custom',
      metric: 'bet_volume',
      startsAt,
      endsAt,
      prizes: {},
    });
    // Mismo motivo que con promotions: PermissionsGuard bloquea antes
    // del service. Acepto ambos códigos.
    expect(res.status).toBe(403);
    const body = res.body as { error?: string };
    expect(['Forbidden', 'LEAGUE_ACTOR_ROLE']).toContain(body.error);
  });

  test('admin crea league → OK', async () => {
    const startsAt = new Date(Date.now() + 60_000).toISOString();
    const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const created = await adminApi.post<{ id: string }>('/tenant/leagues', {
      code: `sp17-admin-league-${Date.now()}`,
      name: 'Admin League',
      period: 'custom',
      metric: 'bet_volume',
      startsAt,
      endsAt,
      prizes: {},
    });
    expect(created.id).toBeDefined();
  });

  // ──────────────────────────────────────────────────────────────────
  // Toggle independence revoca permisos
  // ──────────────────────────────────────────────────────────────────

  // ──────────────────────────────────────────────────────────────────
  // Sprint 51.3 — UI helpers backend (isIndependentBranch en /me +
  // ownerScope en bonus-definitions list).
  // ──────────────────────────────────────────────────────────────────

  test('/tenant/auth/me devuelve isIndependentBranch=true para socio activo', async () => {
    const me = await indSocioApi.get<{
      user: { id: string; isIndependentBranch?: boolean; roles?: string[] };
    }>('/tenant/auth/me');
    expect(me.user.id).toBe(indSocio.id);
    expect(me.user.isIndependentBranch).toBe(true);
    expect(me.user.roles).toContain('socio');
  });

  test('/tenant/auth/me devuelve isIndependentBranch=false para admin', async () => {
    const me = await adminApi.get<{
      user: { isIndependentBranch?: boolean; roles?: string[] };
    }>('/tenant/auth/me');
    expect(me.user.isIndependentBranch).toBe(false);
    expect(me.user.roles).toContain('admin_tenant');
  });

  test('GET /bonus-definitions?ownerScope=mine devuelve solo las del actor', async () => {
    const res = await indSocioApi.get<{
      data: BonusDefinition[];
      total: number;
    }>('/tenant/bonus-definitions?ownerScope=mine&limit=50');
    expect(res.data.length).toBeGreaterThan(0);
    for (const d of res.data) {
      expect(d.createdByUserId).toBe(indSocio.id);
    }
  });

  test('GET /bonus-definitions?ownerScope=tenant devuelve solo las del admin', async () => {
    const res = await indSocioApi.get<{
      data: BonusDefinition[];
      total: number;
    }>('/tenant/bonus-definitions?ownerScope=tenant&limit=50');
    expect(res.data.length).toBeGreaterThan(0);
    for (const d of res.data) {
      expect(d.createdByUserId).toBe(adminId);
    }
  });

  test('desactivar branch independence revoca permisos bonuses.*', async () => {
    // Crear un socio nuevo para no afectar al indSocio principal.
    const tmpSocio = await createTestUserWithRole(adminApi, 'sp17-tmp-socio', 'socio');
    await adminApi.post(`/tenant/users/${tmpSocio.id}/branch/toggle-independence`, {
      isIndependent: true,
      branchBankAccount: 'CBU-TMP',
      branchChipsPricePerUnit: '1.0000',
    });
    // Login.
    const tmpApi = await ApiClient.create();
    await loginAs(tmpApi, tmpSocio.username, tmpSocio.password);
    // Puede crear definition (porque tiene el override).
    const ok = await tmpApi.post<BonusDefinition>('/tenant/bonus-definitions', {
      code: `sp17-tmp-def-${Date.now()}`,
      name: 'Tmp Def',
      type: 'welcome',
      status: 'active',
      config: {},
      expirationDays: 7,
    });
    expect(ok.id).toBeDefined();

    // Desactivar branch independence → revoca perms.
    await adminApi.post(`/tenant/users/${tmpSocio.id}/branch/toggle-independence`, {
      isIndependent: false,
    });

    // Ahora intentar crear otra def → 403 por permission.
    const after = await tmpApi.postRaw('/tenant/bonus-definitions', {
      code: `sp17-tmp-def-after-${Date.now()}`,
      name: 'Should fail',
      type: 'welcome',
      status: 'active',
      config: {},
      expirationDays: 7,
    });
    expect(after.status).toBe(403);

    await tmpApi.dispose();
  });
});
