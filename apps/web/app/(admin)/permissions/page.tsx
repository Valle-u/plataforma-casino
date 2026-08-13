/** /permissions — redirige a /settings (se movió a Configuración). */
import { redirect } from 'next/navigation';

export default function PermissionsRedirect() {
  redirect('/settings');
}
