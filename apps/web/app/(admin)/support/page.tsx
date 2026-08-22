/**
 * /support — bandeja de livechat del operador. Detrás del flag CRM_ENABLED (el
 * item del sidebar solo aparece con el flag ON; si alguien entra directo con el
 * flag OFF, mostramos un aviso en vez del inbox). Ver docs/22-crm-livechat.md.
 */

'use client';

import { MessagesSquare } from 'lucide-react';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';
import { OperatorInbox } from '@/components/admin/chat/operator-inbox';
import { CRM_ENABLED } from '@/lib/chat/flag';

export default function SupportPage(): React.ReactElement {
  return (
    <PageShell>
      <PageHeader
        icon={MessagesSquare}
        title="Soporte"
        description="Chateá en vivo con tus jugadores. Cada operador ve solo sus conversaciones."
      />
      {CRM_ENABLED ? (
        <OperatorInbox />
      ) : (
        <p style={{ color: 'var(--color-fg-muted)', fontSize: 14 }}>
          El módulo de soporte no está habilitado.
        </p>
      )}
    </PageShell>
  );
}
