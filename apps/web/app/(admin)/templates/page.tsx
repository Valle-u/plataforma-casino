/** /templates — redirige a /settings (se movió a Configuración). */
import { redirect } from 'next/navigation';

export default function TemplatesRedirect() {
  redirect('/settings');
}
