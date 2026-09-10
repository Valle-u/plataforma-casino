/**
 * /support/contactos — la agenda de la bandeja.
 *
 * Cuelga de `/support/` porque es lo único que el host del CRM deja pasar (ver
 * `lib/crm-host.ts`), así que la sección existe sin tocar el middleware.
 *
 * Entrando por el panel (`admin.`) la ruta también funciona: es el mismo build.
 * Ahí se ve dentro del shell del panel, con su padding — la tabla no necesita
 * alto fijo, así que no hay dos versiones como en la bandeja.
 */

'use client';

import { Contactos } from '@/components/admin/crm/contactos';
import { CRM_ENABLED } from '@/lib/chat/flag';

export default function ContactosPage(): React.ReactElement {
  if (!CRM_ENABLED) {
    return (
      <p style={{ color: 'var(--color-fg-muted)', fontSize: 14, padding: 16 }}>
        El módulo de soporte no está habilitado.
      </p>
    );
  }
  return <Contactos />;
}
