/**
 * Flag del CRM/livechat en el front. Espejo de `CRM_ENABLED` del backend.
 *
 * NEXT_PUBLIC_* se inlinea en build: con la env sin setear (default), tanto el
 * widget del jugador como la bandeja del operador NO se montan → cero efecto en
 * prod hasta prenderlo. Ver docs/22-crm-livechat.md §10.
 */
export const CRM_ENABLED = process.env.NEXT_PUBLIC_CRM_ENABLED === '1';
