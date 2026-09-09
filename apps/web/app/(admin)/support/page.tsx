/**
 * /support — bandeja de livechat del operador. Detrás del flag CRM_ENABLED (el
 * item del sidebar solo aparece con el flag ON; si alguien entra directo con el
 * flag OFF, mostramos un aviso en vez del inbox). Ver docs/22-crm-livechat.md.
 */

'use client';

import Link from 'next/link';
import { MessagesSquare, Send } from 'lucide-react';
import type { CSSProperties } from 'react';
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
        actions={
          CRM_ENABLED ? (
            // El acceso a los canales vive acá y no en el menú lateral: se usa
            // una vez para vincular un bot y después no se vuelve a mirar. En
            // el menú sería un item permanente para algo que casi no se abre.
            <Link href="/support/canales" className="admin-nav-link" style={linkCanales}>
              <Send size={14} /> Canales
            </Link>
          ) : null
        }
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

const linkCanales: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  fontSize: 13,
  color: 'var(--color-fg-muted)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  textDecoration: 'none',
};
