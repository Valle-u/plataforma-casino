'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { DEFAULT_PLATFORM_NAME } from '@/lib/brand';
import { useTenantInfo } from './use-tenant-branding';

const SECTION_TITLES: Record<string, string> = {
  '/play': 'Inicio',
  '/play/lobby': 'Juegos',
  '/play/account': 'Mi cuenta',
  '/play/deposits': 'Depósitos',
  '/play/withdrawals': 'Retiros',
  '/play/notifications': 'Notificaciones',
  '/play/bonuses': 'Bonos',
  '/dashboard': 'Panel · Inicio',
  '/users': 'Panel · Usuarios',
  '/wallet': 'Panel · Wallet',
  '/deposits': 'Panel · Depósitos',
  '/withdrawals': 'Panel · Retiros',
  '/settings': 'Panel · Configuración',
  '/mi-diseno': 'Panel · Mi diseño',
};

export function useDynamicTitle() {
  const pathname = usePathname();
  const tenantInfo = useTenantInfo();
  const designBrand = tenantInfo.data?.design?.brand as { platformName?: string } | undefined;
  const platformName = designBrand?.platformName || tenantInfo.data?.tenant?.name || DEFAULT_PLATFORM_NAME;

  useEffect(() => {
    // Encontrar la sección que coincida con el pathname actual
    let section = '';
    for (const [path, label] of Object.entries(SECTION_TITLES)) {
      if (pathname === path || pathname.startsWith(path + '/') || pathname.startsWith(path + '?')) {
        section = label;
        break;
      }
    }
    // Player: "<sección> · <casino>" (el jugador ve la marca del casino).
    // Panel: "Panel · <sección>" SIN el nombre del casino — el panel tiene
    // identidad propia y su favicon fijo ya lo distingue de la pestaña del
    // casino. Las etiquetas del panel ya arrancan con "Panel · "; el resto de
    // rutas del panel cae a "Panel" a secas.
    if (pathname.startsWith('/play')) {
      document.title = section ? `${section} · ${platformName}` : platformName;
    } else {
      document.title = section || 'Panel';
    }
  }, [pathname, platformName]);
}
