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
   * Cluster confirmed por admin → notif a otros admins / cajeros.
   * Payload:
   *   - clusterSize: number
   *   - topScore: number
   *   - confirmedByUsername: string
   */
  fraud_cluster_confirmed: (payload) => ({
    subject: 'Nuevo cluster de fraude confirmado',
    body:
      `Se confirmó un cluster de cuentas vinculadas.\n\n` +
      `Tamaño: ${payload['clusterSize'] ?? '?'} cuentas\n` +
      `Score más alto: ${payload['topScore'] ?? '?'}\n` +
      `Confirmado por: ${str(payload, 'confirmedByUsername', 'admin')}\n\n` +
      `Revisá el panel de antifraude para más detalles.`,
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
