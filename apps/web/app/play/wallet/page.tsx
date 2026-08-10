import { redirect } from 'next/navigation';

/**
 * /play/wallet → /play/account (tab Movimientos).
 *
 * Parte A del plan perfil/wallet (docs/21-plan-perfil-wallet.md): la pantalla
 * "Movimientos" vive ahora en la página única "Mi cuenta".
 */
export default function PlayWalletRedirectPage() {
  redirect('/play/account?tab=movimientos');
}
