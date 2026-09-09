/**
 * /support/canales — los canales externos de la bandeja del operador (**2.5**).
 *
 * Ruta propia y no una pestaña adentro de la bandeja: vincular un bot es algo
 * que se hace una vez y después no se vuelve a mirar, así que no tiene por qué
 * ocupar lugar al lado de las conversaciones.
 *
 * Cuelga de `/support/` a propósito: es la única rama que el host del CRM deja
 * pasar (ver `lib/crm-host.ts`), así que también funciona entrando por
 * `crm.miamihub.vip`.
 */

'use client';

import { Send } from 'lucide-react';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';
import { CanalesDeTelegram } from '@/components/admin/chat/canales-de-telegram';
import { CRM_ENABLED } from '@/lib/chat/flag';

export default function CanalesPage(): React.ReactElement {
  return (
    <PageShell>
      <PageHeader
        icon={Send}
        title="Canales"
        description="Por dónde te pueden escribir tus jugadores, además del chat de la plataforma."
      />
      {CRM_ENABLED ? (
        <CanalesDeTelegram />
      ) : (
        <p style={{ color: 'var(--color-fg-muted)', fontSize: 14 }}>
          El módulo de soporte no está habilitado.
        </p>
      )}
    </PageShell>
  );
}
