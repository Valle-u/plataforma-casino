/**
 * Los canales, como se ven en la bandeja: nombre, color y orden.
 *
 * El diseño le da a cada canal **un color propio** —verde WhatsApp, azul
 * Telegram, gris el livechat— y lo usa en tres lugares: el punto del filtro, el
 * tinte del avatar en la lista, y el chip de la cabecera de la conversación.
 * Con el mapeo repartido, un canal nuevo aparece de un color en un lado y de
 * otro en el resto.
 *
 * Los colores salen de los tokens semánticos del panel, no de hexadecimales
 * sueltos: son los mismos que ya significan "entra plata" y "informativo" en el
 * resto de la plataforma, y el handoff los reusa a propósito.
 */

export interface CanalVisible {
  /** Como lo guarda `crm_channels.type`. */
  tipo: string;
  /** Como se llama en la interfaz. Copy final del handoff. */
  label: string;
  /** Variable CSS del color del canal. */
  color: string;
}

export const CANALES: CanalVisible[] = [
  { tipo: 'whatsapp', label: 'WhatsApp', color: 'var(--color-success)' },
  { tipo: 'telegram', label: 'Telegram', color: 'var(--color-info, #8fb6ff)' },
  // ⚠️ `web-livechat`, no `web`. Es el valor que escribe el backend
  // (`WEB_CHANNEL` en `chat.service.ts`) y hay que copiarlo tal cual: con
  // `web` el filtro de Livechat no matchea nada y la lista aparece vacía **sin
  // ningún error** — el síntoma más caro de encontrar.
  { tipo: 'web-livechat', label: 'Livechat', color: 'var(--color-fg-muted)' },
];

/**
 * Cómo se muestra un canal. Para uno desconocido devuelve algo legible en vez
 * de nada: `crm_channels.type` es texto libre y puede aparecer uno que este
 * código todavía no conoce.
 */
export function canalVisible(tipo: string | undefined): CanalVisible {
  if (!tipo) return { tipo: '', label: '', color: 'var(--color-fg-subtle)' };
  return (
    CANALES.find((c) => c.tipo === tipo) ?? {
      tipo,
      label: tipo,
      color: 'var(--color-fg-subtle)',
    }
  );
}
