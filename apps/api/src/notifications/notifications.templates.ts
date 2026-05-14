/**
 * Templates hardcoded de notifications.
 *
 * MVP: templates en código (no editables por admin). Cada `kind`
 * declara un renderer que toma el payload tipado y devuelve `subject`
 * + `body`. El `enqueue` del service llama acá al recibir un kind.
 *
 * Diseño:
 *   - Los renderers son funciones puras — fáciles de testear.
 *   - El payload es `Record<string, unknown>` para flexibilidad,
 *     pero cada renderer hace su propio cast typed via Zod si quiere
 *     validar shape estricta. MVP: cast simple sin Zod.
 *   - Si el kind NO tiene template registrado, `enqueue` tira.
 *     Forzamos al caller a registrar template antes de emitir notifs
 *     de un kind nuevo — protección contra typos en kind strings.
 *
 * Sprint futuro: `notification_templates` tabla con templates
 * editables por tenant. Este registry queda como fallback default.
 */

export interface RenderedTemplate {
  subject: string;
  body: string;
}

export type TemplateRenderer = (payload: Record<string, unknown>) => RenderedTemplate;

/**
 * Helper común: si el payload tiene un campo string, lo devuelve.
 * Sino, devuelve fallback. Defensivo para hooks que no validan el
 * payload exhaustivamente.
 */
function str(payload: Record<string, unknown>, key: string, fallback = ''): string {
  const v = payload[key];
  return typeof v === 'string' ? v : fallback;
}

export const NOTIFICATION_TEMPLATES: Record<string, TemplateRenderer> = {
  // ── Bonos ─────────────────────────────────────────────────────────────
  /**
   * Welcome bonus bloqueado por antifraude (cluster confirmed score ≥ 90).
   * Mensaje neutro — NO le decimos "estás flagged como fraude". Solo le
   * decimos que el bono no se aplicó y que contacte soporte. Defensivo:
   * si el flag es false positive, el user puede aclarar.
   *
   * Payload esperado:
   *   - depositId: string
   *   - reason: string (opcional, e.g. "revisión de seguridad")
   */
  welcome_bonus_blocked: (payload) => ({
    subject: 'Tu bono de bienvenida requiere revisión',
    body:
      `Hola,\n\n` +
      `Tu depósito reciente (id: ${str(payload, 'depositId')}) fue ` +
      `procesado correctamente y ya está disponible en tu wallet, pero ` +
      `el bono de bienvenida quedó pendiente de revisión por nuestro ` +
      `equipo de seguridad.\n\n` +
      `Si tenés dudas o querés acelerar el proceso, contactá soporte.\n\n` +
      `Saludos.`,
  }),

  // ── Fraud (admin notif) ───────────────────────────────────────────────
  /**
   * Link confirmed por admin → notif a otros admins.
   * Payload:
   *   - linkId: string
   *   - score: number
   *   - userAUsername: string
   *   - userBUsername: string
   *   - confirmedByUsername: string
   */
  fraud_cluster_confirmed: (payload) => ({
    subject: 'Nuevo link de fraude confirmado',
    body:
      `Se confirmó un link entre dos cuentas como fraude.\n\n` +
      `Cuentas: ${str(payload, 'userAUsername', '?')} ↔ ${str(payload, 'userBUsername', '?')}\n` +
      `Score: ${payload['score'] ?? '?'}\n` +
      `Confirmado por: ${str(payload, 'confirmedByUsername', 'admin')}\n` +
      `Link ID: ${str(payload, 'linkId')}\n\n` +
      `Revisá el panel de antifraude para más detalles.`,
  }),

  // ── Deposits ──────────────────────────────────────────────────────────
  /**
   * Depósito aprobado por cajero/admin → notif al user.
   * Payload:
   *   - depositId: string
   *   - amountChips: string (numeric "100.50")
   */
  deposit_approved: (payload) => ({
    subject: 'Tu depósito fue aprobado',
    body:
      `Hola,\n\n` +
      `Tu depósito (id: ${str(payload, 'depositId')}) por ` +
      `${str(payload, 'amountChips', '?')} fichas fue aprobado y ya está ` +
      `disponible en tu wallet.\n\n` +
      `¡A jugar!\n\n` +
      `Saludos.`,
  }),

  // ── Withdrawals ───────────────────────────────────────────────────────
  /**
   * Retiro pagado → notif al user.
   * Payload:
   *   - withdrawalId: string
   *   - amountChips: string
   *   - externalRef: string (referencia bancaria opcional)
   */
  withdrawal_paid: (payload) => {
    const ref = str(payload, 'externalRef');
    return {
      subject: 'Tu retiro fue procesado',
      body:
        `Hola,\n\n` +
        `Tu retiro (id: ${str(payload, 'withdrawalId')}) por ` +
        `${str(payload, 'amountChips', '?')} fichas fue procesado y ` +
        `transferido a tu medio de pago.\n` +
        (ref ? `Referencia: ${ref}\n` : '') +
        `\nSi no recibiste el pago en las próximas horas, contactá soporte.\n\n` +
        `Saludos.`,
    };
  },

  /**
   * Depósito rechazado → notif al user con motivo.
   * Payload:
   *   - depositId: string
   *   - amountChips: string
   *   - reason: string (motivo del cajero/admin)
   */
  deposit_rejected: (payload) => ({
    subject: 'Tu depósito fue rechazado',
    body:
      `Hola,\n\n` +
      `Tu depósito (id: ${str(payload, 'depositId')}) por ` +
      `${str(payload, 'amountChips', '?')} fichas no pudo ser aprobado.\n\n` +
      `Motivo: ${str(payload, 'reason', 'sin especificar')}\n\n` +
      `Si tenés dudas o creés que es un error, contactá soporte.\n\n` +
      `Saludos.`,
  }),

  /**
   * Retiro rechazado → notif al user. El hold se libera y el saldo
   * vuelve al wallet del user.
   * Payload:
   *   - withdrawalId: string
   *   - amountChips: string
   *   - reason: string
   */
  withdrawal_rejected: (payload) => ({
    subject: 'Tu retiro fue rechazado',
    body:
      `Hola,\n\n` +
      `Tu retiro (id: ${str(payload, 'withdrawalId')}) por ` +
      `${str(payload, 'amountChips', '?')} fichas fue rechazado.\n\n` +
      `Motivo: ${str(payload, 'reason', 'sin especificar')}\n\n` +
      `El saldo fue devuelto a tu wallet y podés volver a intentarlo, ` +
      `corrigiendo lo necesario o contactando soporte.\n\n` +
      `Saludos.`,
  }),

  /**
   * Retiro falló en el procesamiento (e.g. error bancario) → notif al
   * user. El hold se libera. Diferencia con rejected: el problema NO
   * fue del cajero rechazando — algo en la operación bancaria falló.
   * Payload:
   *   - withdrawalId: string
   *   - amountChips: string
   *   - reason: string
   */
  withdrawal_failed: (payload) => ({
    subject: 'Tu retiro no pudo procesarse',
    body:
      `Hola,\n\n` +
      `Tu retiro (id: ${str(payload, 'withdrawalId')}) por ` +
      `${str(payload, 'amountChips', '?')} fichas no pudo procesarse y ` +
      `fue marcado como fallido.\n\n` +
      `Detalle: ${str(payload, 'reason', 'sin especificar')}\n\n` +
      `El saldo fue devuelto a tu wallet. Probá nuevamente o contactá ` +
      `soporte si el problema persiste.\n\n` +
      `Saludos.`,
  }),

  // ── Bonos ─────────────────────────────────────────────────────────────
  /**
   * Bono expirado por el cron de retención → notif al user.
   * Payload:
   *   - bonusId: string
   *   - remainingAmount: string (lo que quedaba sin usar — se revierte al funder)
   */
  bonus_expired: (payload) => ({
    subject: 'Tu bono expiró',
    body:
      `Hola,\n\n` +
      `Tu bono (id: ${str(payload, 'bonusId')}) llegó a su fecha de vencimiento ` +
      `con ${str(payload, 'remainingAmount', '0')} fichas sin liberar.\n\n` +
      `Si necesitabas más tiempo para usarlo, contactá soporte para ver ` +
      `tus opciones.\n\n` +
      `Saludos.`,
  }),

  /**
   * Bono cancelado manualmente por cajero/admin → notif al user.
   * Payload:
   *   - bonusId: string
   *   - reason: string (motivo del operador)
   */
  bonus_cancelled: (payload) => ({
    subject: 'Tu bono fue cancelado',
    body:
      `Hola,\n\n` +
      `Tu bono (id: ${str(payload, 'bonusId')}) fue cancelado por nuestro ` +
      `equipo.\n\n` +
      `Motivo: ${str(payload, 'reason', 'sin especificar')}\n\n` +
      `Si tenés dudas, contactá soporte.\n\n` +
      `Saludos.`,
  }),

  // ── Generic test (para tests E2E) ─────────────────────────────────────
  test_event: (payload) => ({
    subject: `Test: ${str(payload, 'title', 'sin título')}`,
    body: str(payload, 'message', 'sin mensaje'),
  }),
};

/**
 * Render seguro. Si el kind no existe, tira error explícito —
 * el caller debe haber registrado template antes de emitir notifs
 * de un kind nuevo.
 */
export function renderTemplate(
  kind: string,
  payload: Record<string, unknown>,
): RenderedTemplate {
  const renderer = NOTIFICATION_TEMPLATES[kind];
  if (!renderer) {
    throw new Error(
      `No template registrado para notification kind '${kind}'. ` +
        `Agregar entry en NOTIFICATION_TEMPLATES.`,
    );
  }
  return renderer(payload);
}
