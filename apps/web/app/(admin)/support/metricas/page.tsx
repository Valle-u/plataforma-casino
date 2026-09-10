/**
 * /support/metricas — cómo se está atendiendo, medido sobre tramos.
 *
 * Cuelga de `/support/` como el resto de las secciones del CRM: es lo único que
 * el host del CRM deja pasar (ver `lib/crm-host.ts`). Entrando por el panel
 * (`admin.`) la misma ruta funciona — es el mismo build.
 */

'use client';

import { Metricas } from '@/components/admin/crm/metricas';
import { CRM_ENABLED } from '@/lib/chat/flag';

export default function MetricasPage(): React.ReactElement {
  if (!CRM_ENABLED) {
    return (
      <p style={{ color: 'var(--color-fg-muted)', fontSize: 14, padding: 16 }}>
        El módulo de soporte no está habilitado.
      </p>
    );
  }
  return <Metricas />;
}
