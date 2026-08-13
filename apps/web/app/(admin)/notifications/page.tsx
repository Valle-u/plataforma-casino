/** /notifications — redirige a /settings (se movió a Configuración). */
import { redirect } from 'next/navigation';

export default function NotificationsRedirect() {
  redirect('/settings');
}
