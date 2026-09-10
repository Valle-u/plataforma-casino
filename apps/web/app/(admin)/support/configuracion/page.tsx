/**
 * /support/configuracion — el gestor de etiquetas del CRM.
 *
 * Cuelga de `/support/` porque es lo único que el host del CRM deja pasar (ver
 * `lib/crm-host.ts`), así que la sección existe sin tocar el middleware.
 */

'use client';

import { Configuracion } from '@/components/admin/crm/configuracion';
import { CRM_ENABLED } from '@/lib/chat/flag';

export default function ConfiguracionPage(): React.ReactElement {
  if (!CRM_ENABLED) {
    return (
      <p style={{ color: 'var(--color-fg-muted)', fontSize: 14, padding: 16 }}>
        El módulo de soporte no está habilitado.
      </p>
    );
  }
  return <Configuracion />;
}
