/**
 * /support/respuestas — las plantillas del casino.
 *
 * Cuelga de `/support/` porque es lo único que el host del CRM deja pasar (ver
 * `lib/crm-host.ts`), así que la sección existe sin tocar el middleware.
 */

'use client';

import { RespuestasRapidas } from '@/components/admin/crm/respuestas-rapidas';
import { CRM_ENABLED } from '@/lib/chat/flag';

export default function RespuestasPage(): React.ReactElement {
  if (!CRM_ENABLED) {
    return (
      <p style={{ color: 'var(--color-fg-muted)', fontSize: 14, padding: 16 }}>
        El módulo de soporte no está habilitado.
      </p>
    );
  }
  return <RespuestasRapidas />;
}
