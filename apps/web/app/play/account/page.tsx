import { AccountTabs, isAccountTab } from '@/components/player/account/account-tabs';

/**
 * /play/account — página única "Mi cuenta" del jugador (Parte A del plan
 * perfil/wallet, docs/21-plan-perfil-wallet.md).
 *
 * Tabs: Perfil · Mi dinero · Movimientos · Seguridad. El tab activo se lee
 * del query string (?tab=) para que los redirects de /play/wallet y
 * /play/settings aterricen en la sección correcta.
 */

export default async function PlayAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return <AccountTabs initialTab={isAccountTab(tab) ? tab : 'perfil'} />;
}
