/**
 * E2E: DepositsController — F2 (deposits refactor a issuer-aware).
 *
 * Antes: al aprobar un deposit se MINTAABAN fichas nuevas en la wallet del
 * player. Ahora: se TRANSFIERE desde el issuer (Casa o socio independiente
 * dueño de la rama) al player, preservando la invariante "1 ficha = 1 peso,
 * todo respaldado" (docs/16).
 *
 * Casos cubiertos:
 *   T-D1: approve player-de-indep con socio FONDEADO → transfer indep→player,
 *         Casa no se mueve, par de wallet_transactions con la misma idem key.
 *   T-D2: approve player-de-indep con indep SIN saldo → 409
 *         ISSUER_INSUFFICIENT_BALANCE (isCasa=false), deposit sigue pending,
 *         wallets sin cambios.
 *   T-D3: approve player-de-Casa (sin indep arriba) con Casa fondeada →
 *         transfer Casa→player, ningún indep se toca (regresión modelo).
 *   T-D4: approve player-de-Casa con Casa sin saldo → 409
 *         ISSUER_INSUFFICIENT_BALANCE (isCasa=true).
 *   T-D5: VIP bonus fail-soft — indep con saldo justo para el deposit base
 *         pero NO para el bonus VIP → deposit base OK, bonus skippeado, sin
 *         abortar la operación (docs: bonus es un gift).
 */

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { HOUSE_USERNAME } from '@casino/db';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';
import { matchBankTxForDeposit } from '../helpers/bank-tx';
import { getTestTenantUrl } from '../setup/db-helpers';

interface DepositView {
  id: string;
  userId: string;
  status: string;
  amountChips: string;
  amountFiat: string;
  currencyFiat: string;
  walletTxId: string | null;
}

interface IssuerInsufficientBody {
  error: string;
  message: string;
  available: string;
  required: string;
  issuerUserId: string | null;
  isCasa: boolean;
}

interface DepositTxView {
  userId: string;
  type: string;
  source: string;
  amount: string;
  /**
   * `idempotency_key` es UNIQUE tenant-wide en `wallet_transactions`, así que
   * `executeTransferPair` solo la escribe en el lado SOURCE (issuer / `transfer_out`).
   * El lado TARGET (player / `deposit`) queda con `null`. El vínculo entre los dos
   * lados se hace por `reference_id = <depositId>` + `source = 'deposit_flow'`.
   */
  idempotencyKey: string | null;
}

async function createPaymentMethod(code: string, ownerId?: string): Promise<string> {
  const client = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await client<{ id: string }[]>`
      INSERT INTO payment_methods (id, code, name, type, config, is_active, owner_id)
      VALUES (gen_random_uuid(), ${code}, ${code + ' display'}, 'bank_transfer',
              '{"cbu":"0000000000000000000000"}'::jsonb, true, ${ownerId ?? null})
      RETURNING id
    `;
    return rows[0]!.id;
  } finally {
    await client.end();
  }
}

describe('DepositsController — F2 issuer-aware (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let methodId: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    methodId = await createPaymentMethod(`f2-method-${Date.now().toString(36)}`);
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Helpers de topología
  // ──────────────────────────────────────────────────────────────────────

  async function makeUser(label: string, role: string): Promise<TestUser> {
    return createTestUser(ctx.request, adminToken, {
      suite: 'dep-f2',
      label,
      role,
    });
  }

  /**
   * Habilita a un operador a conciliar sus propias transferencias.
   *
   * ⚠️ Hace falta porque **ningún rol de operador trae `bank_tx.*` por
   * default**: en `tenant-seed.ts` ni `socio`, ni `distribuidor`, ni `cajero`
   * los tienen — sólo el admin. Los dos permisos son `isDelegatable: true`,
   * así que el modelo previsto es que el admin los otorgue a quien concilia.
   *
   * En una red independiente **cada operador concilia lo suyo** (decisión del
   * dueño, 2026-09-03): el cajero sus transferencias, el distribuidor
   * independiente las suyas, el socio las suyas. El admin no toca esa sub-red
   * — desde `c189a60` el match valida el scope del dueño de la solicitud y
   * devuelve 404 si el actor queda afuera.
   */
  async function allowBankTx(userId: string): Promise<void> {
    for (const permissionCode of ['bank_tx.upload', 'bank_tx.match']) {
      const r = await ctx.request
        .post('/tenant/permission-overrides/grant')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ userId, permissionCode, reason: 'e2e: concilia su propia red' });
      expect([200, 201]).toContain(r.status);
    }
  }

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

  /**
   * Carga el CBU propio de un operador **sin** marcarlo como sucursal
   * independiente.
   *
   * Desde 2026-09-03 cada cajero y distribuidor dentro de una red independiente
   * opera contra SU banco: sin CBU cargado no puede subir transferencias
   * (`BANK_TX_NO_CBU`). En producción el CBU sale de su método de pago, que
   * dispara `syncBranchBankAccountFromPaymentMethods`; acá se setea directo.
   */
  async function setOwnBankAccount(userId: string, cbu: string): Promise<void> {
    await ctx.tenantDb.execute(
      sql`UPDATE users SET branch_bank_account = ${cbu} WHERE id = ${userId}`,
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

  async function getCasaUserId(): Promise<string> {
    const rows = (await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${HOUSE_USERNAME} LIMIT 1`,
    )) as unknown as Array<{ id: string }>;
    return rows[0]!.id;
  }

  /**
   * Fondea EXACTAMENTE la wallet a `targetAmount` (idempotente). Útil cuando
   * un test necesita que el issuer tenga un saldo específico (e.g. "justo
   * insuficiente para el bonus" en T-D5, o "solo $50" en T-D2). Usa un
   * UPDATE directo respaldado por un mint tx para preservar balance == Σtx.
   */
  async function setWalletBalanceExact(
    userId: string,
    targetAmount: string,
  ): Promise<void> {
    const client = postgres(getTestTenantUrl(), { max: 1 });
    try {
      // Insert wallet if missing.
      await client`
        INSERT INTO wallets (id, user_id, balance)
        VALUES (gen_random_uuid(), ${userId}, ${targetAmount})
        ON CONFLICT (user_id) DO UPDATE SET balance = ${targetAmount}::numeric
      `;
      const rows = await client<{ id: string; balance: string }[]>`
        SELECT id, balance FROM wallets WHERE user_id = ${userId} LIMIT 1
      `;
      const w = rows[0]!;
      await client`
        INSERT INTO wallet_transactions
          (id, wallet_id, type, amount, balance_after, source, reason, idempotency_key)
        VALUES
          (gen_random_uuid(), ${w.id}, 'mint', ${targetAmount},
           ${w.balance}, 'test_funding_exact',
           'ajuste exacto para test F2',
           ${`fund-exact-${Date.now()}-${Math.random().toString(36).slice(2)}`})
      `;
    } finally {
      await client.end();
    }
  }

  /**
   * Trae el par de wallet_transactions asociado a un deposit específico
   * (source=deposit_flow, idempotency_key=deposit:<id>). Devuelve ambos lados.
   */
  async function getDepositTxPair(depositId: string): Promise<{
    player: DepositTxView | null;
    issuer: DepositTxView | null;
  }> {
    const rows = (await ctx.tenantDb.execute(
      sql`SELECT w.user_id AS user_id, wt.type::text AS type,
                 wt.source AS source, wt.amount::text AS amount,
                 wt.idempotency_key AS idempotency_key
          FROM wallet_transactions wt
          JOIN wallets w ON w.id = wt.wallet_id
          WHERE wt.source = 'deposit_flow'
            AND wt.reference_id = ${depositId}::uuid`,
    )) as unknown as Array<{
      user_id: string;
      type: string;
      source: string;
      amount: string;
      idempotency_key: string;
    }>;
    let player: DepositTxView | null = null;
    let issuer: DepositTxView | null = null;
    for (const r of rows) {
      const view: DepositTxView = {
        userId: r.user_id,
        type: r.type,
        source: r.source,
        amount: r.amount,
        idempotencyKey: r.idempotency_key ?? null,
      };
      if (r.type === 'deposit') player = view;
      else if (r.type === 'transfer_out') issuer = view;
    }
    return { player, issuer };
  }

  async function createDeposit(
    playerToken: string,
    amountFiat: string,
    methodIdToUse: string = methodId,
  ): Promise<string> {
    const r = await ctx.request
      .post('/tenant/deposits')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', playerToken)
      .send({
        methodId: methodIdToUse,
        amountFiat,
        currencyFiat: 'ARS',
        amountChips: amountFiat, // server recalcula (chips_per_unit=1)
        receiptUrl: 'https://test.local/receipt.jpg',
        receiptStorageKey: 'test/receipts/proof.jpg',
      });
    if (r.status !== 201) {
      throw new Error(`createDeposit falló ${r.status} ${JSON.stringify(r.body)}`);
    }
    return (r.body as { deposit: { id: string } }).deposit.id;
  }

  // ──────────────────────────────────────────────────────────────────────
  // T-D1: indep fondeado → transfer indep→player, Casa intacta.
  // ──────────────────────────────────────────────────────────────────────

  it('T-D1: approve player-de-indep con socio fondeado → transfer indep→player, Casa NO se mueve', async () => {
    const socio = await makeUser('td1_socio', 'socio');
    await makeIndependent(socio.id, 'CBU-INDEP-TD1');
    const player = await makeUser('td1_player', 'usuario_final');
    await setParent(player.id, socio.id);

    await fundWalletForTests(socio.id, '1000'); // bankroll del indep

    // Método de pago del PADRE DIRECTO (socio indep) — regla Sprint 53/55:
    // method.ownerId === parent.parentUserId. Un método tenant-level (NULL)
    // NO sirve para un player de sucursal independiente.
    const socioMethod = await createPaymentMethod('td1-method', socio.id);

    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const depositId = await createDeposit(playerToken, '100', socioMethod);

    // ⚠️ Concilia el SOCIO INDEPENDIENTE, no el admin.
    //
    // En una red independiente **cada operador concilia lo suyo**: el cajero sus
    // transferencias, el distribuidor independiente las suyas, el socio las
    // suyas (decisión del dueño, 2026-09-03). El admin no toca esa sub-red.
    //
    // El test ya lo hacía bien para el approve —"el padre directo aprueba, NO el
    // admin"— pero seguía matcheando con el token del admin. Desde el arreglo
    // `c189a60` (2026-08-25) eso devuelve 404: el match valida que el dueño de
    // la solicitud caiga en el scope del actor, no sólo la bank_tx. El 404 es
    // deliberado, para no filtrar si el recurso existe.
    const socioToken = await loginAs(ctx.request, socio.username, socio.password);
    await allowBankTx(socio.id);
    await matchBankTxForDeposit(ctx.request, socioToken, depositId, null);

    // Snapshot ANTES.
    const casaBefore = await getCasaBalance();
    const socioBefore = await getBalance(socio.id);
    const playerBefore = await getBalance(player.id);
    const r = await ctx.request
      .post(`/tenant/deposits/${depositId}/approve`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioToken);
    expect(r.status).toBe(200);
    const body = r.body as { deposit: DepositView; walletTxId: string };
    expect(body.deposit.status).toBe('approved');
    expect(body.deposit.walletTxId).toBeTruthy();

    // Snapshot DESPUÉS.
    const casaAfter = await getCasaBalance();
    const socioAfter = await getBalance(socio.id);
    const playerAfter = await getBalance(player.id);

    // Player recibe +100.
    expect(playerAfter - playerBefore).toBeCloseTo(100, 2);
    // Socio indep pierde -100 (fondeó él, no la Casa).
    expect(socioAfter - socioBefore).toBeCloseTo(-100, 2);
    // La Casa NO se mueve — el modelo dice que la sub-red del indep es un
    // "casino separado" (docs/17). El deposit no la afecta.
    expect(casaAfter).toBeCloseTo(casaBefore, 2);

    // Par de wallet_transactions con misma idempotency_key.
    const pair = await getDepositTxPair(depositId);
    expect(pair.player).not.toBeNull();
    expect(pair.issuer).not.toBeNull();
    expect(pair.player!.userId).toBe(player.id);
    expect(pair.player!.type).toBe('deposit');
    expect(pair.player!.source).toBe('deposit_flow');
    expect(pair.issuer!.userId).toBe(socio.id);
    expect(pair.issuer!.type).toBe('transfer_out');
    expect(pair.issuer!.source).toBe('deposit_flow');
    expect(pair.issuer!.idempotencyKey).toBe(`deposit:${depositId}`);
    expect(pair.player!.idempotencyKey).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-D2: indep SIN saldo → 409 ISSUER_INSUFFICIENT_BALANCE.
  // ──────────────────────────────────────────────────────────────────────

  it('T-D2: approve player-de-indep sin saldo suficiente → 409 ISSUER_INSUFFICIENT_BALANCE (isCasa=false), deposit sigue pending', async () => {
    const socio = await makeUser('td2_socio', 'socio');
    await makeIndependent(socio.id, 'CBU-INDEP-TD2');
    const player = await makeUser('td2_player', 'usuario_final');
    await setParent(player.id, socio.id);

    // Indep fondeado solo con $50, pero el deposit pide $100 → insuficiente.
    await fundWalletForTests(socio.id, '50');

    const socioMethod = await createPaymentMethod('td2-method', socio.id);

    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const depositId = await createDeposit(playerToken, '100', socioMethod);

    // Concilia el socio independiente, no el admin — ver T-D1.
    const socioToken = await loginAs(ctx.request, socio.username, socio.password);
    await allowBankTx(socio.id);
    await matchBankTxForDeposit(ctx.request, socioToken, depositId, null);

    const casaBefore = await getCasaBalance();
    const socioBefore = await getBalance(socio.id);
    const playerBefore = await getBalance(player.id);

    // El padre directo (socio independiente) intenta aprobar — NO el admin.
    const r = await ctx.request
      .post(`/tenant/deposits/${depositId}/approve`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioToken);

    expect(r.status).toBe(409);
    const body = r.body as IssuerInsufficientBody;
    expect(body.error).toBe('ISSUER_INSUFFICIENT_BALANCE');
    expect(Number(body.available)).toBeCloseTo(50, 2);
    expect(Number(body.required)).toBeCloseTo(100, 2);
    expect(body.isCasa).toBe(false);
    expect(body.issuerUserId).toBe(socio.id);

    // Deposit sigue pending. Lo consulta el padre directo (el admin ya no ve
    // el detalle de una solicitud independiente — le daría 404).
    const detail = await ctx.request
      .get(`/tenant/deposits/${depositId}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioToken);
    expect(detail.status).toBe(200);
    expect(
      (detail.body as { deposit: DepositView }).deposit.status,
    ).toBe('pending');

    // Nada se movió.
    expect(await getCasaBalance()).toBeCloseTo(casaBefore, 2);
    expect(await getBalance(socio.id)).toBeCloseTo(socioBefore, 2);
    expect(await getBalance(player.id)).toBeCloseTo(playerBefore, 2);
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-D3: player-de-Casa (sin indep arriba) → Casa fondea, ningún indep se toca.
  // ──────────────────────────────────────────────────────────────────────

  it('T-D3: approve player-de-Casa con Casa fondeada → transfer Casa→player', async () => {
    // No creamos socio arriba — el player queda como tenant-wide (bancado
    // por la Casa). La Casa ya fue fondeada por bootstrapTestApp
    // (fundHouseForTests) con un bankroll grande.
    const player = await makeUser('td3_player', 'usuario_final');
    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const depositId = await createDeposit(playerToken, '100');
    await matchBankTxForDeposit(ctx.request, adminToken, depositId);

    const casaBefore = await getCasaBalance();
    const playerBefore = await getBalance(player.id);
    const casaUserId = await getCasaUserId();

    const r = await ctx.request
      .post(`/tenant/deposits/${depositId}/approve`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(r.status).toBe(200);

    const casaAfter = await getCasaBalance();
    const playerAfter = await getBalance(player.id);

    expect(playerAfter - playerBefore).toBeCloseTo(100, 2);
    expect(casaAfter - casaBefore).toBeCloseTo(-100, 2);

    // Par de wallet_transactions: el lado issuer debe ser el user Casa.
    const pair = await getDepositTxPair(depositId);
    expect(pair.player).not.toBeNull();
    expect(pair.issuer).not.toBeNull();
    expect(pair.issuer!.userId).toBe(casaUserId);
    expect(pair.issuer!.idempotencyKey).toBe(`deposit:${depositId}`);
    expect(pair.player!.idempotencyKey).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-D4: Casa sin saldo → 409 ISSUER_INSUFFICIENT_BALANCE (isCasa=true).
  // ──────────────────────────────────────────────────────────────────────

  it('T-D4: approve player-de-Casa sin saldo suficiente en Casa → 409 ISSUER_INSUFFICIENT_BALANCE (isCasa=true)', async () => {
    const casaUserId = await getCasaUserId();
    // Guardamos el bankroll para restaurarlo después del test (no queremos
    // dejar la Casa vacía para tests posteriores del mismo suite).
    const casaOriginal = await getCasaBalance();
    try {
      // Setear la Casa a $50 exactos.
      await setWalletBalanceExact(casaUserId, '50');

      const player = await makeUser('td4_player', 'usuario_final');
      const playerToken = await loginAs(ctx.request, player.username, player.password);
      const depositId = await createDeposit(playerToken, '100');
      await matchBankTxForDeposit(ctx.request, adminToken, depositId);

      const casaBefore = await getCasaBalance();
      const playerBefore = await getBalance(player.id);

      const r = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      expect(r.status).toBe(409);
      const body = r.body as IssuerInsufficientBody;
      expect(body.error).toBe('ISSUER_INSUFFICIENT_BALANCE');
      expect(Number(body.available)).toBeCloseTo(50, 2);
      expect(Number(body.required)).toBeCloseTo(100, 2);
      expect(body.isCasa).toBe(true);

      // Deposit sigue pending, wallets sin cambios.
      const detail = await ctx.request
        .get(`/tenant/deposits/${depositId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(
        (detail.body as { deposit: DepositView }).deposit.status,
      ).toBe('pending');
      expect(await getCasaBalance()).toBeCloseTo(casaBefore, 2);
      expect(await getBalance(player.id)).toBeCloseTo(playerBefore, 2);
    } finally {
      // Restaurar bankroll de la Casa para tests posteriores.
      await setWalletBalanceExact(casaUserId, casaOriginal.toFixed(2));
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-D5: VIP bonus fail-soft — indep con saldo justo para deposit base
  //       pero no para bonus VIP → base OK, bonus skippeado.
  // ──────────────────────────────────────────────────────────────────────

  it('T-D5: VIP bonus fail-soft — indep con saldo exacto para el deposit base pero no para el bonus → base OK, bonus skippeado', async () => {
    // Crear tier VIP con depositBonusPct=20 (si no existe, insert; si existe,
    // update). El player estará asignado a este tier via user_vip_status.
    const tierCode = `f2-vip-${Date.now().toString(36)}`;
    await ctx.tenantDb.execute(sql`
      INSERT INTO vip_tiers
        (id, code, label, color, threshold_chips, deposit_bonus_pct,
         cashback_pct, perks_json, sort_order, is_active)
      VALUES
        (gen_random_uuid(), ${tierCode}, ${'F2 VIP ' + tierCode}, '#FFD700',
         '0', '20', '0', '{}'::jsonb, 99, true)
      ON CONFLICT (code) DO UPDATE SET deposit_bonus_pct = '20', is_active = true
    `);

    const socio = await makeUser('td5_socio', 'socio');
    await makeIndependent(socio.id, 'CBU-INDEP-TD5');
    const player = await makeUser('td5_player', 'usuario_final');
    await setParent(player.id, socio.id);

    // Forzar tier del player a `tierCode` (bypasseamos el recompute que si
    // no llegaría a bronze; user_vip_status upsert directo, con
    // recomputedAt reciente para que getMyStatus NO re-compute).
    await ctx.tenantDb.execute(sql`
      INSERT INTO user_vip_status
        (user_id, current_tier_code, volume_30d, recomputed_at)
      VALUES
        (${player.id}, ${tierCode}, '0', now())
      ON CONFLICT (user_id) DO UPDATE
        SET current_tier_code = ${tierCode},
            recomputed_at = now()
    `);

    // Indep fondeado con EXACTAMENTE $100 — alcanza para el base ($100)
    // pero no para el +20% VIP ($120 total). El VipService debería skippear
    // el bonus con log warn y NO abortar el deposit base.
    await setWalletBalanceExact(socio.id, '100');

    const socioMethod = await createPaymentMethod('td5-method', socio.id);

    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const depositId = await createDeposit(playerToken, '100', socioMethod);

    // Concilia el socio independiente, no el admin — ver T-D1.
    const socioToken = await loginAs(ctx.request, socio.username, socio.password);
    await allowBankTx(socio.id);
    await matchBankTxForDeposit(ctx.request, socioToken, depositId, null);

    const socioBefore = await getBalance(socio.id);
    const playerBefore = await getBalance(player.id);

    // El padre directo (socio independiente) aprueba — NO el admin.
    const r = await ctx.request
      .post(`/tenant/deposits/${depositId}/approve`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioToken);
    expect(r.status).toBe(200);
    expect(
      (r.body as { deposit: DepositView }).deposit.status,
    ).toBe('approved');

    const socioAfter = await getBalance(socio.id);
    const playerAfter = await getBalance(player.id);

    // Deposit base: player +100, indep -100. Exactamente eso — el bonus
    // NO se aplicó (indep hubiera necesitado $120 total).
    expect(playerAfter - playerBefore).toBeCloseTo(100, 2);
    expect(socioAfter - socioBefore).toBeCloseTo(-100, 2);

    // Sanity: el player NO llega a 120 (que sería base + bonus).
    expect(playerAfter - playerBefore).not.toBeCloseTo(120, 2);
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-D6: ruteo al PADRE DIRECTO en cadena independiente de 3 niveles.
  //   socio(indep) → cajero → player. La solicitud del player la ve y la
  //   acepta SOLO su padre directo (el cajero). El abuelo (socio) y el admin
  //   quedan fuera: no la listan, no ven el detalle (404) ni la aprueban (403).
  //   Este es el corazón del modelo descentralizado: "solo el padre directo".
  // ──────────────────────────────────────────────────────────────────────

  it('T-D6: solicitud de player-de-indep solo la ve/acepta su padre directo (cajero), no el abuelo ni el admin', async () => {
    const socio = await makeUser('td6_socio', 'socio');
    await makeIndependent(socio.id, 'CBU-INDEP-TD6');
    const cajero = await makeUser('td6_cajero', 'cajero');
    await setParent(cajero.id, socio.id);
    const player = await makeUser('td6_player', 'usuario_final');
    await setParent(player.id, cajero.id);

    // El indep raíz banca la carga → lo fondeamos para que el approve del
    // padre directo llegue a 200.
    await fundWalletForTests(socio.id, '1000');

    // Método del PADRE DIRECTO del player = el cajero (no el socio abuelo).
    const cajeroMethod = await createPaymentMethod('td6-method', cajero.id);

    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const cajeroToken = await loginAs(ctx.request, cajero.username, cajero.password);
    const socioToken = await loginAs(ctx.request, socio.username, socio.password);

    const depositId = await createDeposit(playerToken, '100', cajeroMethod);

    // VISIBILIDAD (listado): solo el padre directo (cajero) lo ve.
    const listSeesIt = async (token: string): Promise<boolean> => {
      const r = await ctx.request
        .get('/tenant/deposits?status=pending&limit=100')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(r.status).toBe(200);
      return (r.body as { data: Array<{ id: string }> }).data.some(
        (d) => d.id === depositId,
      );
    };
    expect(await listSeesIt(cajeroToken)).toBe(true); // padre directo
    expect(await listSeesIt(socioToken)).toBe(false); // abuelo
    expect(await listSeesIt(adminToken)).toBe(false); // red centralizada

    // DETALLE: 200 padre directo; 404 abuelo + admin (no revela existencia).
    const detailStatus = async (token: string): Promise<number> => {
      const r = await ctx.request
        .get(`/tenant/deposits/${depositId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      return r.status;
    };
    expect(await detailStatus(cajeroToken)).toBe(200);
    expect(await detailStatus(socioToken)).toBe(404);
    expect(await detailStatus(adminToken)).toBe(404);

    // APROBAR: abuelo y admin quedan fuera de scope (403) pese a tener el
    // permiso deposits.approve. Solo el padre directo puede.
    //
    // ⚠️ Concilia el CAJERO, que acá es el padre directo. Antes esto matcheaba
    // con el token del admin — tres líneas después de que el propio test
    // afirmara `detailStatus(adminToken) === 404`. Si el admin no puede ni ver
    // la solicitud, tampoco puede conciliarla: desde `c189a60` el match valida
    // el scope del dueño y devuelve el mismo 404.
    await allowBankTx(cajero.id);
    // El cajero opera contra SU banco, así que necesita su propio CBU.
    await setOwnBankAccount(cajero.id, 'CBU-CAJERO-TD6');
    await matchBankTxForDeposit(ctx.request, cajeroToken, depositId, null);
    const approveStatus = async (token: string): Promise<number> => {
      const r = await ctx.request
        .post(`/tenant/deposits/${depositId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      return r.status;
    };
    expect(await approveStatus(socioToken)).toBe(403); // abuelo
    expect(await approveStatus(adminToken)).toBe(403); // admin
    expect(await approveStatus(cajeroToken)).toBe(200); // padre directo ✓
  });
});
