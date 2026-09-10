/**
 * /support — la bandeja del operador.
 *
 * ## Dos vistas de la misma bandeja
 *
 * Entrando por el **host del CRM** (`crm.`) se ve la bandeja del handoff: tres
 * columnas de alto fijo, dentro del shell propio del CRM.
 *
 * Entrando por el **panel** (`admin.`) se ve la de siempre, que vive adentro de
 * una página con padding que scrollea con el body. Ahí las tres columnas no
 * entran: el shell del panel no tiene alto fijo, y forzarlo rompería el resto
 * de las pantallas.
 *
 * No es duplicación: las dos usan `useBandeja`, o sea el mismo socket, el mismo
 * borrador y los mismos adjuntos. Lo único distinto es el dibujo.
 *
 * La del panel es transitoria. El CRM es "una página aparte con su propio
 * subdominio" por decisión del dueño, así que `/support` en el panel deja de
 * tener razón de ser cuando el CRM esté completo — pero se saca **después** de
 * que el nuevo esté probado, no antes.
 *
 * Todo detrás del flag `CRM_ENABLED`: con el flag apagado, ni una ni la otra.
 */

'use client';

import Link from 'next/link';
import { MessagesSquare, Send } from 'lucide-react';
import type { CSSProperties } from 'react';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';
import { OperatorInbox } from '@/components/admin/chat/operator-inbox';
import { Bandeja } from '@/components/admin/crm/bandeja';
import { CRM_ENABLED } from '@/lib/chat/flag';
import { useEsHostDeCrm } from '@/lib/crm/host-context';

export default function SupportPage(): React.ReactElement {
  const esCrm = useEsHostDeCrm();

  if (!CRM_ENABLED) {
    return (
      <PageShell>
        <PageHeader
          icon={MessagesSquare}
          title="Soporte"
          description="Chateá en vivo con tus jugadores."
        />
        <p style={{ color: 'var(--color-fg-muted)', fontSize: 14 }}>
          El módulo de soporte no está habilitado.
        </p>
      </PageShell>
    );
  }

  // En el CRM la bandeja ES la pantalla: sin encabezado ni padding, de borde a
  // borde. El título de la sección lo pone el shell.
  if (esCrm) return <Bandeja />;

  return (
    <PageShell>
      <PageHeader
        icon={MessagesSquare}
        title="Soporte"
        description="Chateá en vivo con tus jugadores. Cada operador ve solo sus conversaciones."
        actions={
          // En el panel éste es el ÚNICO acceso a Canales: no está en el menú
          // lateral. En el CRM sobra —ahí Canales es una sección— pero esta
          // rama sólo corre en el panel.
          <Link href="/support/canales" className="admin-nav-link" style={linkCanales}>
            <Send size={14} /> Canales
          </Link>
        }
      />
      <OperatorInbox />
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
