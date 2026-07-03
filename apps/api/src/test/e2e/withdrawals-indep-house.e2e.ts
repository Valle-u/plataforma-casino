/**
 * E2E: WithdrawalsController — F3 (withdrawals refactor a issuer-aware con
 * snapshot al create).
 *
 * Antes: al marcar `paid` un withdrawal se BURNEABAN fichas de la wallet del
 * player. Ahora: se TRANSFIERE del player al issuer congelado en `create`
 * (Casa o socio independiente dueño de la rama). El issuer del snapshot NO
 * cambia aunque la jerarquía del player mute entre create y markPaid — es
 * la sucursal que ejecuta la transferencia real vía su banco, y por eso
 * recibe las fichas del player (preserva "1 ficha = 1 peso, todo respaldado"
 * de docs/16).
 *
 * Casos cubiertos:
 *   T-W1: markPaid de player-de-indep → transfer player→indep, chips NO se
 *         destruyen. Casa intacta. Par de wallet_transactions con
 *         idempotencyKey='withdrawal:<id>' en el lado source.
 *   T-W2: markPaid de player-de-Casa (sin indep arriba) → transfer player→Casa.
 *   T-W3: degradación indep→dep entre create y markPaid → el snapshot del
 *         create se respeta: ex-indep recibe las chips, no la Casa.
 *   T-W4: create de player-de-indep snapshottea el issuer (wallet + operator).
 *   T-W5: create de player-de-Casa snapshottea la Casa (operatorUserId=null).
 *   T-W6: reject libera hold, no toca issuer wallet ni player balance.
 */

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { HOUSE_USERNAME } from '@casino/db';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';
import { matchOutgoingBankTxForWithdrawal } from '../helpers/bank-tx';
import { getTestTenantUrl } from '../setup/db-helpers';

interface WithdrawalView {
  id: string;
  userId: string;
  status: string;
  amountChips: string;
  amountFiat: string;
  currencyFiat: string;
  holdId: string | null;
  walletTxId: string | null;
  rejectionReason: string | null;
  failureReason: string | null;
  paidExternalRef: string | null;
}

interface WithdrawalTxView {
  userId: string;
  type: string;
  source: string;
  amount: string;
  /**
   * `idempotency_key` es UNIQUE tenant-wide en `wallet_transactions`, así que
   * `debitWithHoldReleaseAndTransfer` solo la escribe en el lado SOURCE
   * (player / `withdrawal`). El lado TARGET (issuer / `transfer_in`) queda
   * con `null`. El vínculo entre los dos lados se hace por
   * `reference_id = <withdrawalId>` + `source = 'withdrawal_flow'`.
   */
  idempotencyKey: string | null;
}

interface WithdrawalSnapshotRow {
  issuerWalletId: string | null;
  issuerOperatorUserId: string | null;
}

async function createPaymentMethod(code: string): Promise<string> {
  const client = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await client<{ id: string }[]>`
      INSERT INTO payment_methods (id, code, name, type, config, is_active)
      VALUES (gen_random_uuid(), ${code}, ${code + ' display'}, 'bank_transfer',
              '{"cbu":"0000000000000000000000"}'::jsonb, true)
      RETURNING id
    `;
    return rows[0]!.id;
  } finally {
    await client.end();
  }
}

describe('WithdrawalsController — F3 issuer-aware con snapshot (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let methodId: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    methodId = await createPaymentMethod(`f3-method-${Date.now().toString(36)}`);
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Helpers de topología (calcados de deposits-indep-house.e2e.ts)
  // ──────────────────────────────────────────────────────────────────────

  async function makeUser(label: string, role: string): Promise<TestUser> {
    return createTestUser(ctx.request, adminToken, {
      suite: 'wd-f3',
      label,
      role,
    });
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

  async function getBalance(userId: string): Promise<number> {
    const rows = (await ctx.tenantDb.execute(
      sql`SELECT balance FROM wallets WHERE user_id = ${userId} LIMIT 1`,
    )) as unknown as Array<{ balance: string }>;
    return Number(rows[0]?.balance ?? 0);
  }

  async function getLockedBalance(userId: string): Promise<number> {
    const rows = (await ctx.tenantDb.execute(
      sql`SELECT locked_balance FROM wallets WHERE user_id = ${userId} LIMIT 1`,
    )) as unknown as Array<{ locked_balance: string }>;
    return Number(rows[0]?.locked_balance ?? 0);
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

  async function getCasaWalletId(): Promise<string> {
    const rows = (await ctx.tenantDb.execute(
      sql`SELECT w.id FROM wallets w
          JOIN users u ON u.id = w.user_id
          WHERE u.username = ${HOUSE_USERNAME} LIMIT 1`,
    )) as unknown as Array<{ id: string }>;
    return rows[0]!.id;
  }

  async function getWalletId(userId: string): Promise<string> {
    const rows = (await ctx.tenantDb.execute(
      sql`SELECT id FROM wallets WHERE user_id = ${userId} LIMIT 1`,
    )) as unknown as Array<{ id: string }>;
    return rows[0]!.id;
  }

  /**
   * Trae el par de wallet_transactions asociado a un withdrawal específico
   * (source=withdrawal_flow, reference_id=<withdrawalId>). Devuelve ambos
   * lados: player (type=withdrawal, con idempotencyKey) e issuer
   * (type=transfer_in, sin idempotencyKey).
   */
  async function getWithdrawalTxPair(withdrawalId: string): Promise<{
    player: WithdrawalTxView | null;
    issuer: WithdrawalTxView | null;
  }> {
    const rows = (await ctx.tenantDb.execute(
      sql`SELECT w.user_id AS user_id, wt.type::text AS type,
                 wt.source AS source, wt.amount::text AS amount,
                 wt.idempotency_key AS idempotency_key
          FROM wallet_transactions wt
          JOIN wallets w ON w.id = wt.wallet_id
          WHERE wt.source = 'withdrawal_flow'
            AND wt.reference_id = ${withdrawalId}::uuid`,
    )) as unknown as Array<{
      user_id: string;
      type: string;
      source: string;
      amount: string;
      idempotency_key: string | null;
    }>;
    let player: WithdrawalTxView | null = null;
    let issuer: WithdrawalTxView | null = null;
    for (const r of rows) {
      const view: WithdrawalTxView = {
        userId: r.user_id,
        type: r.type,
        source: r.source,
        amount: r.amount,
        idempotencyKey: r.idempotency_key ?? null,
      };
      if (r.type === 'withdrawal') player = view;
      else if (r.type === 'transfer_in') issuer = view;
    }
    return { player, issuer };
  }

  async function getWithdrawalSnapshot(
    withdrawalId: string,
  ): Promise<WithdrawalSnapshotRow> {
    const rows = (await ctx.tenantDb.execute(
      sql`SELECT issuer_wallet_id, issuer_operator_user_id
          FROM withdrawals
          WHERE id = ${withdrawalId}::uuid
          LIMIT 1`,
    )) as unknown as Array<{
      issuer_wallet_id: string | null;
      issuer_operator_user_id: string | null;
    }>;
    const row = rows[0];
    if (!row) throw new Error(`withdrawal ${withdrawalId} not found`);
    return {
      issuerWalletId: row.issuer_wallet_id,
      issuerOperatorUserId: row.issuer_operator_user_id,
    };
  }

  async function createWithdrawal(
    playerToken: string,
    amountChips: string,
  ): Promise<string> {
    const r = await ctx.request
      .post('/tenant/withdrawals')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', playerToken)
      .send({
        methodId,
        amountChips,
        amountFiat: amountChips, // chips_per_unit=1
        currencyFiat: 'ARS',
        targetAccount: { cbu: '0000000000000000000000' },
      });
    if (r.status !== 201) {
      throw new Error(
        `createWithdrawal falló ${r.status} ${JSON.stringify(r.body)}`,
      );
    }
    return (r.body as { withdrawal: { id: string } }).withdrawal.id;
  }

  async function approveWithdrawal(withdrawalId: string): Promise<void> {
    const r = await ctx.request
      .post(`/tenant/withdrawals/${withdrawalId}/approve`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    if (r.status !== 200) {
      throw new Error(
        `approveWithdrawal falló ${r.status} ${JSON.stringify(r.body)}`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // T-W1: player-de-indep pagado → transfer player→indep, chips no se
  //       destruyen; Casa intacta.
  // ──────────────────────────────────────────────────────────────────────

  it('T-W1: markPaid de player-de-indep → transfer player→indep, chips NO se destruyen, Casa intacta', async () => {
    const socio = await makeUser('tw1_socio', 'socio');
    await makeIndependent(socio.id, 'CBU-INDEP-TW1');
    const player = await makeUser('tw1_player', 'usuario_final');
    await setParent(player.id, socio.id);

    // Fondeo del socio ($500 para pagar el bank_tx outgoing en el mundo
    // real) y del player ($200 para poder pedir un withdrawal).
    await fundWalletForTests(socio.id, '500');
    await fundWalletForTests(player.id, '200');

    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const withdrawalId = await createWithdrawal(playerToken, '80');
    await approveWithdrawal(withdrawalId);
    await matchOutgoingBankTxForWithdrawal(ctx.request, adminToken, withdrawalId);

    // Snapshot ANTES de markPaid.
    const casaBefore = await getCasaBalance();
    const socioBefore = await getBalance(socio.id);
    const playerBefore = await getBalance(player.id);
    const playerLockedBefore = await getLockedBalance(player.id);

    // Sanity: el create ya hizo el hold. Balance sigue 200, locked=80.
    expect(playerBefore).toBeCloseTo(200, 2);
    expect(playerLockedBefore).toBeCloseTo(80, 2);

    const r = await ctx.request
      .post(`/tenant/withdrawals/${withdrawalId}/mark-paid`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ externalRef: 'op-tw1-external' });

    expect(r.status).toBe(200);
    const body = r.body as { withdrawal: WithdrawalView };
    expect(body.withdrawal.status).toBe('paid');
    expect(body.withdrawal.walletTxId).toBeTruthy();
    expect(body.withdrawal.paidExternalRef).toBe('op-tw1-external');

    // Snapshot DESPUÉS.
    const casaAfter = await getCasaBalance();
    const socioAfter = await getBalance(socio.id);
    const playerAfter = await getBalance(player.id);
    const playerLockedAfter = await getLockedBalance(player.id);

    // Player: 200 - 80 = 120, hold liberado (locked=0).
    expect(playerAfter).toBeCloseTo(120, 2);
    expect(playerLockedAfter).toBeCloseTo(0, 2);

    // Socio indep recibió +80 (chips no se destruyen, se transfieren).
    // 500 + 80 = 580.
    expect(socioAfter).toBeCloseTo(580, 2);
    expect(socioAfter - socioBefore).toBeCloseTo(80, 2);

    // Casa intacta.
    expect(casaAfter).toBeCloseTo(casaBefore, 2);

    // Par de wallet_transactions con misma reference_id + source.
    const pair = await getWithdrawalTxPair(withdrawalId);
    expect(pair.player).not.toBeNull();
    expect(pair.issuer).not.toBeNull();

    // Player side: type='withdrawal', amount=80 (magnitud), idem key.
    expect(pair.player!.userId).toBe(player.id);
    expect(pair.player!.type).toBe('withdrawal');
    expect(pair.player!.source).toBe('withdrawal_flow');
    expect(Number(pair.player!.amount)).toBeCloseTo(80, 2);
    expect(pair.player!.idempotencyKey).toBe(`withdrawal:${withdrawalId}`);

    // Issuer side: type='transfer_in', amount=80, sin idem key.
    expect(pair.issuer!.userId).toBe(socio.id);
    expect(pair.issuer!.type).toBe('transfer_in');
    expect(pair.issuer!.source).toBe('withdrawal_flow');
    expect(Number(pair.issuer!.amount)).toBeCloseTo(80, 2);
    expect(pair.issuer!.idempotencyKey).toBeNull();

    // Snapshot en withdrawals row: wallet del socio + operator=socio.id.
    const snap = await getWithdrawalSnapshot(withdrawalId);
    const socioWalletId = await getWalletId(socio.id);
    expect(snap.issuerWalletId).toBe(socioWalletId);
    expect(snap.issuerOperatorUserId).toBe(socio.id);
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-W2: player-de-Casa (sin indep arriba) → transfer player→Casa.
  // ──────────────────────────────────────────────────────────────────────

  it('T-W2: markPaid de player-de-Casa (sin indep arriba) → transfer player→Casa', async () => {
    // Player tenant-wide, bancado por la Casa. La Casa ya fue fondeada por
    // bootstrapTestApp con bankroll grande.
    const player = await makeUser('tw2_player', 'usuario_final');
    await fundWalletForTests(player.id, '200');

    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const withdrawalId = await createWithdrawal(playerToken, '80');
    await approveWithdrawal(withdrawalId);
    await matchOutgoingBankTxForWithdrawal(ctx.request, adminToken, withdrawalId);

    const casaBefore = await getCasaBalance();
    const playerBefore = await getBalance(player.id);
    const casaUserId = await getCasaUserId();

    const r = await ctx.request
      .post(`/tenant/withdrawals/${withdrawalId}/mark-paid`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ externalRef: 'op-tw2-external' });
    expect(r.status).toBe(200);

    const casaAfter = await getCasaBalance();
    const playerAfter = await getBalance(player.id);
    const playerLockedAfter = await getLockedBalance(player.id);

    // Player: 200 - 80 = 120, locked=0.
    expect(playerAfter).toBeCloseTo(120, 2);
    expect(playerAfter - playerBefore).toBeCloseTo(-80, 2);
    expect(playerLockedAfter).toBeCloseTo(0, 2);

    // Casa recibió +80.
    expect(casaAfter - casaBefore).toBeCloseTo(80, 2);

    // El issuer side pertenece al user Casa.
    const pair = await getWithdrawalTxPair(withdrawalId);
    expect(pair.player).not.toBeNull();
    expect(pair.issuer).not.toBeNull();
    expect(pair.issuer!.userId).toBe(casaUserId);
    expect(pair.issuer!.type).toBe('transfer_in');
    expect(Number(pair.issuer!.amount)).toBeCloseTo(80, 2);
    expect(pair.player!.idempotencyKey).toBe(`withdrawal:${withdrawalId}`);
    expect(pair.issuer!.idempotencyKey).toBeNull();

    // Snapshot: issuerWalletId = wallet de la Casa, operatorUserId = NULL
    // (porque el issuer resuelto era la Casa del tenant, no un indep).
    const snap = await getWithdrawalSnapshot(withdrawalId);
    const casaWalletId = await getCasaWalletId();
    expect(snap.issuerWalletId).toBe(casaWalletId);
    expect(snap.issuerOperatorUserId).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-W3: degradación indep→dep entre create y markPaid → el snapshot del
  //       create se respeta: ex-indep recibe las chips, no la Casa.
  // ──────────────────────────────────────────────────────────────────────

  it('T-W3: degradación indep→dep entre create y markPaid → ex-indep recibe las chips (snapshot respetado)', async () => {
    const juan = await makeUser('tw3_juan', 'socio');
    await makeIndependent(juan.id, 'CBU-INDEP-TW3');
    // Bankroll para que JUAN pueda pagar (mundo real) — no bloquea el test
    // pero da realismo.
    await fundWalletForTests(juan.id, '500');

    const player = await makeUser('tw3_player', 'usuario_final');
    await setParent(player.id, juan.id);
    await fundWalletForTests(player.id, '200');

    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const withdrawalId = await createWithdrawal(playerToken, '80');
    await approveWithdrawal(withdrawalId);
    await matchOutgoingBankTxForWithdrawal(ctx.request, adminToken, withdrawalId);

    // Confirmar snapshot ANTES de degradar: apunta a JUAN.
    const snapBefore = await getWithdrawalSnapshot(withdrawalId);
    expect(snapBefore.issuerOperatorUserId).toBe(juan.id);
    const juanWalletId = await getWalletId(juan.id);
    expect(snapBefore.issuerWalletId).toBe(juanWalletId);

    // Degradar JUAN a dep. Usamos force=true por si toggleIndependence
    // detecta estado operativo pendiente (bonos, bank_txs, fraud) y
    // rechaza el modo safe.
    const degrade = await ctx.request
      .post(`/tenant/users/${juan.id}/branch/toggle-independence`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ isIndependent: false, force: true });
    expect([200, 201]).toContain(degrade.status);

    const casaBefore = await getCasaBalance();
    const juanBefore = await getBalance(juan.id);
    const playerBefore = await getBalance(player.id);
    const casaUserId = await getCasaUserId();

    const r = await ctx.request
      .post(`/tenant/withdrawals/${withdrawalId}/mark-paid`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ externalRef: 'op-tw3-external' });
    expect(r.status).toBe(200);

    const casaAfter = await getCasaBalance();
    const juanAfter = await getBalance(juan.id);
    const playerAfter = await getBalance(player.id);

    // Player pierde 80.
    expect(playerAfter - playerBefore).toBeCloseTo(-80, 2);

    // JUAN (ex-indep, hoy dep) recibe 80 — porque el snapshot del create
    // lo eligió a él como issuer y F3 exige respetarlo. La Casa NO se
    // toca aunque JUAN ya no sea indep.
    expect(juanAfter - juanBefore).toBeCloseTo(80, 2);
    expect(casaAfter).toBeCloseTo(casaBefore, 2);

    // Tx pair: issuer side sigue en la wallet de JUAN.
    const pair = await getWithdrawalTxPair(withdrawalId);
    expect(pair.issuer).not.toBeNull();
    expect(pair.issuer!.userId).toBe(juan.id);
    expect(pair.issuer!.userId).not.toBe(casaUserId);

    // Snapshot en DB no se movió (integridad del contrato F3).
    const snapAfter = await getWithdrawalSnapshot(withdrawalId);
    expect(snapAfter.issuerOperatorUserId).toBe(juan.id);
    expect(snapAfter.issuerWalletId).toBe(juanWalletId);
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-W4: create snapshottea correctamente (indep).
  // ──────────────────────────────────────────────────────────────────────

  it('T-W4: create de player-de-indep snapshottea issuer_wallet_id + issuer_operator_user_id', async () => {
    const socio = await makeUser('tw4_socio', 'socio');
    await makeIndependent(socio.id, 'CBU-INDEP-TW4');
    const player = await makeUser('tw4_player', 'usuario_final');
    await setParent(player.id, socio.id);
    await fundWalletForTests(player.id, '200');

    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const withdrawalId = await createWithdrawal(playerToken, '80');

    const snap = await getWithdrawalSnapshot(withdrawalId);
    const socioWalletId = await getWalletId(socio.id);
    expect(snap.issuerWalletId).toBe(socioWalletId);
    expect(snap.issuerWalletId).not.toBeNull();
    expect(snap.issuerOperatorUserId).toBe(socio.id);
    expect(snap.issuerOperatorUserId).not.toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-W5: create de player-de-Casa snapshottea Casa (operatorUserId=null).
  // ──────────────────────────────────────────────────────────────────────

  it('T-W5: create de player-de-Casa snapshottea wallet Casa + issuer_operator_user_id=NULL', async () => {
    const player = await makeUser('tw5_player', 'usuario_final');
    await fundWalletForTests(player.id, '200');

    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const withdrawalId = await createWithdrawal(playerToken, '80');

    const snap = await getWithdrawalSnapshot(withdrawalId);
    const casaWalletId = await getCasaWalletId();
    expect(snap.issuerWalletId).toBe(casaWalletId);
    expect(snap.issuerOperatorUserId).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-W6: reject después de create solo libera hold, no toca issuer wallet.
  // ──────────────────────────────────────────────────────────────────────

  it('T-W6: reject después de create solo libera hold, no toca issuer wallet ni player balance', async () => {
    const socio = await makeUser('tw6_socio', 'socio');
    await makeIndependent(socio.id, 'CBU-INDEP-TW6');
    await fundWalletForTests(socio.id, '500');

    const player = await makeUser('tw6_player', 'usuario_final');
    await setParent(player.id, socio.id);
    await fundWalletForTests(player.id, '200');

    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const withdrawalId = await createWithdrawal(playerToken, '80');

    // Después del create: player 200 / locked 80. Socio 500. Casa: baseline.
    expect(await getBalance(player.id)).toBeCloseTo(200, 2);
    expect(await getLockedBalance(player.id)).toBeCloseTo(80, 2);
    const socioBefore = await getBalance(socio.id);
    const casaBefore = await getCasaBalance();
    expect(socioBefore).toBeCloseTo(500, 2);

    const r = await ctx.request
      .post(`/tenant/withdrawals/${withdrawalId}/reject`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ reason: 'test T-W6 reject' });
    expect(r.status).toBe(200);
    expect((r.body as { withdrawal: WithdrawalView }).withdrawal.status).toBe(
      'rejected',
    );

    // Hold liberado, balance del player intacto.
    expect(await getBalance(player.id)).toBeCloseTo(200, 2);
    expect(await getLockedBalance(player.id)).toBeCloseTo(0, 2);

    // Issuer wallets: sin cambios (ni indep ni Casa se tocan en reject).
    expect(await getBalance(socio.id)).toBeCloseTo(socioBefore, 2);
    expect(await getCasaBalance()).toBeCloseTo(casaBefore, 2);

    // Y no debería existir ningún wallet_transaction del reject.
    const pair = await getWithdrawalTxPair(withdrawalId);
    expect(pair.player).toBeNull();
    expect(pair.issuer).toBeNull();
  });
});
