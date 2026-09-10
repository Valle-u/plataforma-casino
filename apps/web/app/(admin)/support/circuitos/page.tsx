/**
 * /support/circuitos — dónde está parada cada persona de la bandeja.
 *
 * Cuelga de `/support/` como el resto de las secciones del CRM: es lo único que
 * el host del CRM deja pasar (ver `lib/crm-host.ts`). Entrando por el panel
 * (`admin.`) la misma ruta funciona y se ve dentro del shell del panel — es el
 * mismo build.
 */

'use client';

import { Circuitos } from '@/components/admin/crm/circuitos';
import { CRM_ENABLED } from '@/lib/chat/flag';

export default function CircuitosPage(): React.ReactElement {
  if (!CRM_ENABLED) {
    return (
      <p style={{ color: 'var(--color-fg-muted)', fontSize: 14, padding: 16 }}>
        El módulo de soporte no está habilitado.
      </p>
    );
  }
  return <Circuitos />;
}
