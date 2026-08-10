'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useTenantInfo } from './use-tenant-branding';

const SECTION_TITLES: Record<string, string> = {
  '/play': 'Inicio',
  '/play/lobby': 'Juegos',
  '/play/account': 'Mi cuenta',
  '/play/deposits': 'Depósitos',
  '/play/withdrawals': 'Retiros',
  '/play/notifications': 'Notificaciones',
  '/play/bonuses': 'Bonos',
  '/dashboard': 'Panel',
  '/users': 'Panel · Usuarios',
  '/wallet': 'Panel · Wallet',
  '/deposits': 'Panel · Depósitos',
  '/withdrawals': 'Panel · Retiros',
  '/settings': 'Panel · Configuración',
};

export function useDynamicTitle() {
  const pathname = usePathname();
  const tenantInfo = useTenantInfo();
  const designBrand = tenantInfo.data?.design?.brand as { platformName?: string } | undefined;
  const platformName = designBrand?.platformName || tenantInfo.data?.tenant?.name || 'Casino TANGO';

  useEffect(() => {
    // Encontrar la sección que coincida con el pathname actual
    let section = '';
    for (const [path, label] of Object.entries(SECTION_TITLES)) {
      if (pathname === path || pathname.startsWith(path + '/') || pathname.startsWith(path + '?')) {
        section = label;
        break;
      }
    }
    document.title = section ? `${section} · ${platformName}` : platformName;
  }, [pathname, platformName]);
}
