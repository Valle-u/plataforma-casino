import { redirect } from 'next/navigation';

/**
 * /play/settings → /play/account (tab Perfil).
 *
 * Parte A del plan perfil/wallet (docs/21-plan-perfil-wallet.md): perfil y
 * seguridad viven ahora en la página única "Mi cuenta".
 */
export default function PlaySettingsRedirectPage() {
  redirect('/play/account?tab=perfil');
}
