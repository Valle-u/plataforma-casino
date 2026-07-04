/**
 * Constantes del módulo bank-transactions.
 *
 * D2-light — rate-limit de vigilancia sobre `bank_tx.upload`. Motivación:
 * un socio independiente puede subir bank_txs incoming a su propia cuenta
 * sin verificación externa (el modelo lo permite: es su banco). Esto abre
 * un vector de auto-declaración masiva.
 *
 * Solución no invasiva:
 *   - NO se agrega un workflow de review por parte del admin.
 *   - Se detecta y se limita: si el mismo actor supera un umbral por hora
 *     (uploads o monto acumulado), el endpoint responde 429.
 *   - En paralelo, cada upload de un actor "dentro de una sub-red
 *     independiente" (self o descendant) genera un audit event específico
 *     (`bank_tx.upload_indep_self_declared`) para vigilancia del owner.
 *
 * Los thresholds son conservadores para no molestar operación legítima
 * (un cajero rutinariamente sube ~decenas por turno). Si se ajustan,
 * moverlos a `tenant_settings` (per-tenant) es el próximo paso.
 */

/** Ventana de observación en segundos. 1 hora. */
export const BANK_TX_UPLOAD_RATE_WINDOW_SEC = 60 * 60;

/**
 * Máximo de uploads por actor en la ventana. Al 21° upload (inclusive)
 * responde 429.
 */
export const BANK_TX_UPLOAD_RATE_MAX_COUNT = 20;

/**
 * Monto máximo acumulado por actor en la ventana. Un upload que empujaría
 * el total sobre este valor responde 429 antes de insertar.
 * Unidades: mismas que `bank_transactions.amount` (fiat, ARS por default).
 */
export const BANK_TX_UPLOAD_RATE_MAX_AMOUNT = 100_000;

/**
 * Umbral para clasificar el audit event como `severity=high`. Por debajo,
 * queda `severity=medium`. El objetivo es que el owner pueda filtrar en
 * el audit log los eventos con más impacto.
 */
export const BANK_TX_INDEP_HIGH_SEVERITY_AMOUNT = 50_000;
