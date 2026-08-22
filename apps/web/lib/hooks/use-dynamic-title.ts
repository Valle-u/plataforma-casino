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
  '/support': 'Panel · Soporte',
};

export function useDynamicTitle() {
  const pathname = usePathname();
  const tenantInfo = useTenantInfo();
  const designBrand = tenantInfo.data?.design?.brand as { platformName?: string } | undefined;
  const platformName = designBrand?.platformName || tenantInfo.data?.tenant?.name || DEFAULT_PLATFORM_NAME;

  useEffect(() => {
    // Sección que coincida con el pathname — la MÁS específica (prefijo más
    // largo). Sin esto, `/play` sombreaba a `/play/lobby` etc. (todos "Inicio").
    let section = '';
    let bestLen = -1;
    for (const [path, label] of Object.entries(SECTION_TITLES)) {
      if (pathname === path || pathname.startsWith(path + '/') || pathname.startsWith(path + '?')) {
        if (path.length > bestLen) {
          bestLen = path.length;
          section = label;
        }
      }
    }
    // Player: "<sección> · <casino>" (el jugador ve la marca del casino).
    // Panel: "Panel · <sección>" SIN el nombre del casino — el panel tiene
    // identidad propia y su favicon fijo ya lo distingue de la pestaña del
    // casino. Las etiquetas del panel ya arrancan con "Panel · "; el resto de
    // rutas del panel cae a "Panel" a secas.
    const desired = pathname.startsWith('/play')
      ? section
        ? `${section} · ${platformName}`
        : platformName
      : section || 'Panel';

    document.title = desired;

    // El App Router de Next RE-APLICA el title de metadata (el default
    // "Plataforma Casino") en la navegación, a veces DESPUÉS de este efecto,
    // pisando el nuestro (se veía el correcto un instante y volvía al default).
    // Observamos el documento y lo re-aplicamos si algo lo cambia. Loop-safe:
    // solo re-seteamos cuando difiere. Observamos `documentElement` (no `head`)
    // porque en el build de prod Next monta el <title> en el <body>, no en el
    // <head> — un observer sobre <head> no lo veía.
    const obs = new MutationObserver(() => {
      if (document.title !== desired) document.title = desired;
    });
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => obs.disconnect();
  }, [pathname, platformName]);
}
