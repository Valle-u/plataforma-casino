/**
 * E2E: WithdrawalsController — F3 snapshot + F7 (burn puro).
 *
 * Historia:
 *   - F3 introdujo el snapshot del issuer al create (útil como metadata:
 *     qué banco paga el fiat afuera del sistema).
 *   - F7 volvió al modelo de BURN puro: al `markPaid` las fichas del
 *     player se DESTRUYEN. El issuer snapshotteado NO recibe fichas — su
 *     rol es puramente informativo (quién ejecuta el pago fiat externo).
 *
 * Post-F7: no hay más "1 ficha=1 peso todo respaldado" entre wallets del
 * casino cuando un player retira — el player achica el pasivo del casino
 * quemando ficha, y el issuer (Casa o indep) cubre el fiat afuera.
 *
 * Casos cubiertos:
 *   T-W1: markPaid de player-de-indep → burn del player, wallet del socio
 *         indep SIN cambios. Casa intacta. Solo 1 row en
 *         wallet_transactions (player side) con
 *         idempotencyKey='withdrawal:<id>'.
 *   T-W2: markPaid de player-de-Casa (sin indep arriba) → burn del player,
 *         Casa SIN cambios.
 *   T-W3: degradación indep→dep entre create y markPaid → el snapshot del
 *         create sobrevive para auditar quién pagó fiat, pero JUAN NO
 *         recibe chips (burn puro). Casa tampoco.
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
   * Post-F7 (burn puro): `debitWithHoldRelease` escribe una única fila en
   * el lado del player (type='withdrawal', source='withdrawal_flow') con
   * `idempotencyKey='withdrawal:<id>'`. No hay contraparte issuer — las
   * fichas se destruyen.
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
   * Trae las wallet_transactions asociadas a un withdrawal específico
   * (source=withdrawal_flow, reference_id=<withdrawalId>).
   *
   * Post-F7 (burn puro): solo existe la row del player
   * (type='withdrawal'). El campo `issuerTxCount` reporta cuántas rows
   * hay con type='transfer_in' asociadas al mismo withdrawal — debe ser
   * 0 en el modelo burn.
   */
  async function getWithdrawalTx(withdrawalId: string): Promise<{
    player: WithdrawalTxView | null;
    issuerTxCount: number;
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
    let issuerTxCount = 0;
    for (const r of rows) {
      const view: WithdrawalTxView = {
        userId: r.user_id,
        type: r.type,
        source: r.source,
        amount: r.amount,
        idempotencyKey: r.idempotency_key ?? null,
      };
      if (r.type === 'withdrawal') player = view;
      else if (r.type === 'transfer_in') issuerTxCount += 1;
    }
    return { player, issuerTxCount };
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

  async function approveWithdrawal(
    withdrawalId: string,
    token: string = adminToken,
  ): Promise<void> {
    const r = await ctx.request
      .post(`/tenant/withdrawals/${withdrawalId}/approve`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token);
    if (r.status !== 200) {
      throw new Error(
        `approveWithdrawal falló ${r.status} ${JSON.stringify(r.body)}`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // T-W1: player-de-indep pagado → BURN puro. Wallet del socio indep NO
  //       recibe fichas. Casa intacta. El snapshot en la row queda para
  //       auditar quién pagó fiat.
  // ──────────────────────────────────────────────────────────────────────

  it('T-W1: markPaid de player-de-indep → burn del player, wallet del indep SIN cambios, Casa intacta', async () => {
    const socio = await makeUser('tw1_socio', 'socio');
    await makeIndependent(socio.id, 'CBU-INDEP-TW1');
    const player = await makeUser('tw1_player', 'usuario_final');
    await setParent(player.id, socio.id);

    // Fondeo del socio ($500 para pagar el bank_tx outgoing en el mundo
    // real) y del player ($200 para poder pedir un withdrawal).
    await fundWalletForTests(socio.id, '500');
    await fundWalletForTests(player.id, '200');

    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const socioToken = await loginAs(ctx.request, socio.username, socio.password);
    const withdrawalId = await createWithdrawal(playerToken, '80');
    // El padre directo (socio independiente) aprueba y paga — NO el admin.
    // Modelo descentralizado: solo el padre directo ve y acepta la solicitud.
    await approveWithdrawal(withdrawalId, socioToken);
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
      .set('Authorization', socioToken)
      .send();

    expect(r.status).toBe(200);
    const body = r.body as { withdrawal: WithdrawalView };
    expect(body.withdrawal.status).toBe('paid');
    expect(body.withdrawal.walletTxId).toBeTruthy();
    // Sprint 52: paidExternalRef se auto-genera (sin referencia manual).
    expect(body.withdrawal.paidExternalRef).toMatch(/^WTH-/);

    // Snapshot DESPUÉS.
    const casaAfter = await getCasaBalance();
    const socioAfter = await getBalance(socio.id);
    const playerAfter = await getBalance(player.id);
    const playerLockedAfter = await getLockedBalance(player.id);

    // Player: 200 - 80 = 120, hold liberado (locked=0).
    expect(playerAfter).toBeCloseTo(120, 2);
    expect(playerLockedAfter).toBeCloseTo(0, 2);

    // Socio indep SIN cambios: las fichas del player NO se transfieren,
    // se destruyen. El socio indep sigue con 500.
    expect(socioAfter).toBeCloseTo(500, 2);
    expect(socioAfter - socioBefore).toBeCloseTo(0, 2);

    // Casa intacta.
    expect(casaAfter).toBeCloseTo(casaBefore, 2);

    // Solo una wallet_transaction: la del player (burn puro, sin par).
    const txs = await getWithdrawalTx(withdrawalId);
    expect(txs.player).not.toBeNull();
    expect(txs.issuerTxCount).toBe(0);

    // Player side: type='withdrawal', amount=80 (magnitud), idem key.
    expect(txs.player!.userId).toBe(player.id);
    expect(txs.player!.type).toBe('withdrawal');
    expect(txs.player!.source).toBe('withdrawal_flow');
    expect(Number(txs.player!.amount)).toBeCloseTo(80, 2);
    expect(txs.player!.idempotencyKey).toBe(`withdrawal:${withdrawalId}`);

    // Snapshot en withdrawals row: wallet del socio + operator=socio.id
    // (queda para auditar quién ejecutó el pago fiat afuera del sistema,
    // aunque contablemente no reciba fichas).
    const snap = await getWithdrawalSnapshot(withdrawalId);
    const socioWalletId = await getWalletId(socio.id);
    expect(snap.issuerWalletId).toBe(socioWalletId);
    expect(snap.issuerOperatorUserId).toBe(socio.id);
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-W2: player-de-Casa (sin indep arriba) → burn puro, Casa SIN cambios.
  // ──────────────────────────────────────────────────────────────────────

  it('T-W2: markPaid de player-de-Casa (sin indep arriba) → burn del player, Casa SIN cambios', async () => {
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

    const r = await ctx.request
      .post(`/tenant/withdrawals/${withdrawalId}/mark-paid`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send();
    expect(r.status).toBe(200);

    const casaAfter = await getCasaBalance();
    const playerAfter = await getBalance(player.id);
    const playerLockedAfter = await getLockedBalance(player.id);

    // Player: 200 - 80 = 120, locked=0.
    expect(playerAfter).toBeCloseTo(120, 2);
    expect(playerAfter - playerBefore).toBeCloseTo(-80, 2);
    expect(playerLockedAfter).toBeCloseTo(0, 2);

    // Casa SIN cambios: las fichas se destruyen (burn puro). La wallet
    // de la Casa no aumenta al pagar un retiro.
    expect(casaAfter - casaBefore).toBeCloseTo(0, 2);

    // Solo una wallet_transaction: la del player. No hay row del issuer.
    const txs = await getWithdrawalTx(withdrawalId);
    expect(txs.player).not.toBeNull();
    expect(txs.issuerTxCount).toBe(0);
    expect(txs.player!.userId).toBe(player.id);
    expect(txs.player!.type).toBe('withdrawal');
    expect(Number(txs.player!.amount)).toBeCloseTo(80, 2);
    expect(txs.player!.idempotencyKey).toBe(`withdrawal:${withdrawalId}`);

    // Snapshot: issuerWalletId = wallet de la Casa, operatorUserId = NULL
    // (porque el issuer resuelto era la Casa del tenant, no un indep).
    const snap = await getWithdrawalSnapshot(withdrawalId);
    const casaWalletId = await getCasaWalletId();
    expect(snap.issuerWalletId).toBe(casaWalletId);
    expect(snap.issuerOperatorUserId).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-W3: degradación indep→dep entre create y markPaid → el snapshot del
  //       create sobrevive para auditar quién pagó fiat, pero JUAN NO
  //       recibe chips (burn puro). Casa tampoco.
  // ──────────────────────────────────────────────────────────────────────

  it('T-W3: degradación indep→dep entre create y markPaid → snapshot preservado, ex-indep NO recibe chips (burn puro)', async () => {
    const juan = await makeUser('tw3_juan', 'socio');
    await makeIndependent(juan.id, 'CBU-INDEP-TW3');
    // Bankroll para que JUAN pueda pagar (mundo real) — no bloquea el test
    // pero da realismo.
    await fundWalletForTests(juan.id, '500');

    const player = await makeUser('tw3_player', 'usuario_final');
    await setParent(player.id, juan.id);
    await fundWalletForTests(player.id, '200');

    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const juanToken = await loginAs(ctx.request, juan.username, juan.password);
    const withdrawalId = await createWithdrawal(playerToken, '80');
    // Aprueba JUAN (padre directo, aún independiente en este punto). El
    // markPaid corre DESPUÉS de degradar a JUAN → ahí el player ya es de la
    // red centralizada y lo puede marcar pagado el admin.
    await approveWithdrawal(withdrawalId, juanToken);
    await matchOutgoingBankTxForWithdrawal(ctx.request, adminToken, withdrawalId);

    // Confirmar snapshot ANTES de degradar: apunta a JUAN.
    const snapBefore = await getWithdrawalSnapshot(withdrawalId);
    expect(snapBefore.issuerOperatorUserId).toBe(juan.id);
    const juanWalletId = await getWalletId(juan.id);
    expect(snapBefore.issuerWalletId).toBe(juanWalletId);

    // D3 (§14.1): degradar por el ENDPOINT ahora está BLOQUEADO — el retiro está
    // in-flight (approved) y un flip a mitad de camino dejaría el issuer
    // inconsistente. Ni force lo bypassea.
    const degradeBlocked = await ctx.request
      .post(`/tenant/users/${juan.id}/branch/toggle-independence`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ isIndependent: false, force: true });
    expect(degradeBlocked.status).toBe(409);
    expect(degradeBlocked.body.error).toBe('BRANCH_FLIP_PENDING_REQUESTS');

    // Pero la ROBUSTEZ del snapshot igual debe valer si el flag cambia por otra
    // vía. Simulamos la degradación por SQL (sin pasar por el guard) para probar
    // que markPaid usa el snapshot CONGELADO, no el flag actual.
    await ctx.tenantDb.execute(
      sql`UPDATE users
          SET is_independent_branch = false,
              branch_bank_account = NULL,
              branch_chips_price_per_unit = NULL
          WHERE id = ${juan.id}`,
    );

    const casaBefore = await getCasaBalance();
    const juanBefore = await getBalance(juan.id);
    const playerBefore = await getBalance(player.id);

    const r = await ctx.request
      .post(`/tenant/withdrawals/${withdrawalId}/mark-paid`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send();
    expect(r.status).toBe(200);

    const casaAfter = await getCasaBalance();
    const juanAfter = await getBalance(juan.id);
    const playerAfter = await getBalance(player.id);

    // Player pierde 80 (burn).
    expect(playerAfter - playerBefore).toBeCloseTo(-80, 2);

    // JUAN (ex-indep, hoy dep) NO recibe chips: burn puro, nadie acredita.
    // Su wallet queda intacta pese a que el snapshot lo apunta a él.
    expect(juanAfter - juanBefore).toBeCloseTo(0, 2);
    // Casa tampoco recibe nada.
    expect(casaAfter).toBeCloseTo(casaBefore, 2);

    // No hay row de issuer en wallet_transactions (burn puro).
    const txs = await getWithdrawalTx(withdrawalId);
    expect(txs.player).not.toBeNull();
    expect(txs.player!.userId).toBe(player.id);
    expect(txs.issuerTxCount).toBe(0);

    // Snapshot en DB no se movió: queda para auditar QUIÉN pagó el fiat
    // (JUAN, la sucursal snapshotteada al create) aunque no reciba chips.
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
    const socioToken = await loginAs(ctx.request, socio.username, socio.password);
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
      .set('Authorization', socioToken)
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
    const txs = await getWithdrawalTx(withdrawalId);
    expect(txs.player).toBeNull();
    expect(txs.issuerTxCount).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-W7: ruteo al PADRE DIRECTO (retiros) en cadena independiente de 3
  //   niveles. socio(indep) → cajero → player. El retiro lo ve y lo acepta
  //   SOLO el cajero (padre directo). Abuelo + admin: 404 detalle, 403 approve.
  // ──────────────────────────────────────────────────────────────────────

  it('T-W7: retiro de player-de-indep solo lo ve/acepta su padre directo (cajero), no el abuelo ni el admin', async () => {
    const socio = await makeUser('tw7_socio', 'socio');
    await makeIndependent(socio.id, 'CBU-INDEP-TW7');
    const cajero = await makeUser('tw7_cajero', 'cajero');
    await setParent(cajero.id, socio.id);
    const player = await makeUser('tw7_player', 'usuario_final');
    await setParent(player.id, cajero.id);
    await fundWalletForTests(player.id, '200');

    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const cajeroToken = await loginAs(ctx.request, cajero.username, cajero.password);
    const socioToken = await loginAs(ctx.request, socio.username, socio.password);

    const withdrawalId = await createWithdrawal(playerToken, '80');

    // VISIBILIDAD (listado): solo el padre directo (cajero) lo ve.
    const listSeesIt = async (token: string): Promise<boolean> => {
      const r = await ctx.request
        .get('/tenant/withdrawals?status=pending&limit=100')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      expect(r.status).toBe(200);
      return (r.body as { data: Array<{ id: string }> }).data.some(
        (w) => w.id === withdrawalId,
      );
    };
    expect(await listSeesIt(cajeroToken)).toBe(true); // padre directo
    expect(await listSeesIt(socioToken)).toBe(false); // abuelo
    expect(await listSeesIt(adminToken)).toBe(false); // red centralizada

    // DETALLE: 200 padre directo; 404 abuelo + admin (no revela existencia).
    const detailStatus = async (token: string): Promise<number> => {
      const r = await ctx.request
        .get(`/tenant/withdrawals/${withdrawalId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      return r.status;
    };
    expect(await detailStatus(cajeroToken)).toBe(200);
    expect(await detailStatus(socioToken)).toBe(404);
    expect(await detailStatus(adminToken)).toBe(404);

    // APROBAR: abuelo + admin fuera de scope (403); padre directo puede (200).
    const approveStatus = async (token: string): Promise<number> => {
      const r = await ctx.request
        .post(`/tenant/withdrawals/${withdrawalId}/approve`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
      return r.status;
    };
    expect(await approveStatus(socioToken)).toBe(403); // abuelo
    expect(await approveStatus(adminToken)).toBe(403); // admin
    expect(await approveStatus(cajeroToken)).toBe(200); // padre directo ✓
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-W8: markFailed NO puede liberar el hold si ya hay una outgoing bank_tx
  //   matcheada (la plata fiat YA salió). Auditoría economía 2026-07: evita el
  //   doble beneficio (fichas devueltas al jugador + plata ya cobrada afuera).
  // ──────────────────────────────────────────────────────────────────────

  it('T-W8: markFailed con outgoing bank_tx matcheada → 409, el hold NO se libera (anti doble-beneficio)', async () => {
    const player = await makeUser('tw8_player', 'usuario_final');
    await fundWalletForTests(player.id, '200');

    const playerToken = await loginAs(ctx.request, player.username, player.password);
    const withdrawalId = await createWithdrawal(playerToken, '80');
    await approveWithdrawal(withdrawalId);
    // La plata fiat ya salió: matcheamos la outgoing bank_tx.
    await matchOutgoingBankTxForWithdrawal(ctx.request, adminToken, withdrawalId);

    const balanceBefore = await getBalance(player.id);
    const lockedBefore = await getLockedBalance(player.id);
    expect(lockedBefore).toBeCloseTo(80, 2); // hold activo

    const r = await ctx.request
      .post(`/tenant/withdrawals/${withdrawalId}/mark-failed`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ reason: 'T-W8: intento fallar con bank_tx matcheada' });
    expect(r.status).toBe(409);
    expect((r.body as { error?: string }).error).toBe(
      'WITHDRAWAL_HAS_MATCHED_BANK_TX',
    );

    // El hold NO se liberó: el jugador NO recuperó las fichas que ya cobró afuera.
    expect(await getBalance(player.id)).toBeCloseTo(balanceBefore, 2);
    expect(await getLockedBalance(player.id)).toBeCloseTo(lockedBefore, 2);
  });
});
