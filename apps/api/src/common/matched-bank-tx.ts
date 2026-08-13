/**
 * Campos de la TRANSFERENCIA BANCARIA MATCHEADA para enriquecer exports.
 *
 * Tanto un depósito (`deposits.bankTransactionId`) como un retiro
 * (`withdrawals.bankTransactionId`) pueden estar matcheados a una fila de
 * `bank_transactions`. Para que el CSV traiga "todo junto" (la solicitud +
 * los datos de su transferencia en la misma fila), acá centralizamos:
 *   - `MatchedBankTxFields`: los campos aplanados con prefijo `bankTx`.
 *   - `matchedBankTxSelect`: el objeto de columnas para el `.select()` del
 *     leftJoin con `bank_transactions`.
 *   - `matchedBankTxCsvColumns()`: las columnas `bank_tx_*` para `buildCsv`.
 *
 * Los campos quedan en `null` cuando la solicitud todavía no está matcheada
 * (leftJoin sin match). Es solo lectura / export.
 */

import { bankTransactions } from '@casino/db';
import type { CsvColumn } from './csv';

export interface MatchedBankTxFields {
  bankTxId: string | null;
  bankTxAmount: string | null;
  bankTxCurrency: string | null;
  bankTxDirection: string | null;
  bankTxStatus: string | null;
  /** Cuenta/banco del tenant donde entró o desde donde salió la plata. */
  bankTxBankAccount: string | null;
  bankTxBankName: string | null;
  bankTxAccountHolder: string | null;
  /** Contraparte (remitente en entrantes). */
  bankTxSenderName: string | null;
  bankTxSenderCbu: string | null;
  bankTxReference: string | null;
  bankTxReceivedAt: Date | null;
  bankTxMatchedAt: Date | null;
  bankTxReceiptUrl: string | null;
}

/**
 * Columnas del `bank_transactions` a incluir en el `.select()` de un
 * leftJoin. Spread dentro del objeto de select; los alias coinciden 1:1
 * con las keys de `MatchedBankTxFields`, así el rest-spread del `.map()`
 * las captura enteras.
 */
export const matchedBankTxSelect = {
  bankTxId: bankTransactions.id,
  bankTxAmount: bankTransactions.amount,
  bankTxCurrency: bankTransactions.currency,
  bankTxDirection: bankTransactions.direction,
  bankTxStatus: bankTransactions.status,
  bankTxBankAccount: bankTransactions.bankAccount,
  bankTxBankName: bankTransactions.bankName,
  bankTxAccountHolder: bankTransactions.accountHolder,
  bankTxSenderName: bankTransactions.senderName,
  bankTxSenderCbu: bankTransactions.senderCbu,
  bankTxReference: bankTransactions.reference,
  bankTxReceivedAt: bankTransactions.receivedAt,
  bankTxMatchedAt: bankTransactions.matchedAt,
  bankTxReceiptUrl: bankTransactions.receiptUrl,
} as const;

/** Columnas `bank_tx_*` para anexar al final de un CSV de export. */
export function matchedBankTxCsvColumns<
  T extends Partial<MatchedBankTxFields>,
>(): CsvColumn<T>[] {
  return [
    { header: 'bank_tx_id', value: (r) => r.bankTxId },
    { header: 'bank_tx_amount', value: (r) => r.bankTxAmount },
    { header: 'bank_tx_currency', value: (r) => r.bankTxCurrency },
    { header: 'bank_tx_direction', value: (r) => r.bankTxDirection },
    { header: 'bank_tx_status', value: (r) => r.bankTxStatus },
    { header: 'bank_tx_bank_account', value: (r) => r.bankTxBankAccount },
    { header: 'bank_tx_bank_name', value: (r) => r.bankTxBankName },
    { header: 'bank_tx_account_holder', value: (r) => r.bankTxAccountHolder },
    { header: 'bank_tx_sender_name', value: (r) => r.bankTxSenderName },
    { header: 'bank_tx_sender_cbu', value: (r) => r.bankTxSenderCbu },
    { header: 'bank_tx_reference', value: (r) => r.bankTxReference },
    { header: 'bank_tx_received_at', value: (r) => r.bankTxReceivedAt },
    { header: 'bank_tx_matched_at', value: (r) => r.bankTxMatchedAt },
    { header: 'bank_tx_receipt_url', value: (r) => r.bankTxReceiptUrl },
  ];
}
