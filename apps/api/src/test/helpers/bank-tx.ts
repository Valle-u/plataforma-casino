/**
 * Helper de bank_transactions para tests e2e.
 *
 * Sprint 50 (separación de funciones): un depósito necesita una
 * bank_transaction matcheada (`deposit.bankTransactionId`) antes de poder
 * aprobarse — ver `deposits.service.ts` (`DepositRequiresBankTxError`).
 *
 * Este helper crea una bank_tx y la matchea con el depósito usando
 * `override` para desacoplar del monto exacto (el matching de montos lo
 * cubre `bank-transactions.e2e.ts`, no los flujos que solo necesitan un
 * depósito aprobable). Lo llama quien crea el depósito, antes de aprobarlo.
 */

import type supertest from 'supertest';
import { TEST_TENANT } from '../setup/test-tenant';

let seq = 0;

export async function matchBankTxForDeposit(
  request: supertest.Agent,
  adminToken: string,
  depositId: string,
): Promise<void> {
  // Idempotente: si el depósito ya tiene una bank_tx matcheada, no hacemos
  // nada (seguro llamarlo antes de cada approve sin importar el orden).
  const cur = await request
    .get(`/tenant/deposits/${depositId}`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken);
  if (
    cur.status === 200 &&
    (cur.body as { deposit?: { bankTransactionId?: string | null } }).deposit
      ?.bankTransactionId
  ) {
    return;
  }

  const ref = `OP-${Date.now()}-${(seq += 1)}`;
  const btx = await request
    .post('/tenant/bank-transactions')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken)
    .send({
      bankAccount: '0000000000000000000000',
      // Cuenta PROPIA: el alta la exige para entrantes (trazabilidad). El
      // helper no la mandaba y venia fallando desde que se agrego la regla,
      // arrastrando 14 tests de la suite de transferencias.
      bankName: 'Banco Test',
      accountHolder: 'Casino Test',
      amount: '1.00',
      currency: 'ARS',
      reference: ref,
      receivedAt: new Date().toISOString(),
      direction: 'incoming',
    });
  if (btx.status !== 201) {
    throw new Error(
      `bank-tx create falló: ${btx.status} ${JSON.stringify(btx.body)}`,
    );
  }
  const bankTxId = (btx.body as { id: string }).id;
  const m = await request
    .post(`/tenant/bank-transactions/${bankTxId}/match/${depositId}`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken)
    .send({ override: true, overrideReason: 'auto-match para setup de test' });
  if (m.status !== 200) {
    throw new Error(
      `bank-tx match falló: ${m.status} ${JSON.stringify(m.body)}`,
    );
  }
}

/**
 * Sprint 51: un retiro necesita una bank_transaction OUTGOING matcheada
 * antes de poder marcarse como pagado (markPaid). Análogo a
 * matchBankTxForDeposit pero con dirección `outgoing` y el endpoint
 * `match-withdrawal`. El retiro debe estar approved/processing al matchear.
 * Idempotente.
 */
export async function matchOutgoingBankTxForWithdrawal(
  request: supertest.Agent,
  adminToken: string,
  withdrawalId: string,
): Promise<void> {
  const cur = await request
    .get(`/tenant/withdrawals/${withdrawalId}`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken);
  if (
    cur.status === 200 &&
    (cur.body as { withdrawal?: { bankTransactionId?: string | null } })
      .withdrawal?.bankTransactionId
  ) {
    return;
  }

  const ref = `OP-OUT-${Date.now()}-${(seq += 1)}`;
  // Sprint 52: las transferencias salientes requieren comprobante. El
  // helper no sube un archivo real — usa un receiptStorageKey sintético
  // único por llamada (el dedupe por comprobante es lo que se testea en
  // bank-transactions.e2e.ts, no en los flujos que solo necesitan un
  // retiro pagable).
  const btx = await request
    .post('/tenant/bank-transactions')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken)
    .send({
      bankAccount: '0000000000000000000000',
      amount: '1.00',
      currency: 'ARS',
      reference: ref,
      receiptUrl: `http://localhost/proofs/${ref}.pdf`,
      receiptStorageKey: `test/proofs/${ref}.pdf`,
      receivedAt: new Date().toISOString(),
      direction: 'outgoing',
    });
  if (btx.status !== 201) {
    throw new Error(
      `bank-tx(out) create falló: ${btx.status} ${JSON.stringify(btx.body)}`,
    );
  }
  const bankTxId = (btx.body as { id: string }).id;
  const m = await request
    .post(`/tenant/bank-transactions/${bankTxId}/match-withdrawal/${withdrawalId}`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken)
    .send({ override: true, overrideReason: 'auto-match para setup de test' });
  if (m.status !== 200) {
    throw new Error(
      `bank-tx match-withdrawal falló: ${m.status} ${JSON.stringify(m.body)}`,
    );
  }
}
