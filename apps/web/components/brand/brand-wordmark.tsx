/**
 * BrandWordmark — wordmark de marca del casino.
 *
 * Renderiza el logo del tenant como imagen, con opción de sublabel "CASINO"
 * debajo. Única fuente de verdad del wordmark — usar en login, header,
 * sidebar y footer para que la marca sea consistente en toda la app.
 *
 * Acepta `src` opcional desde `branding.logoUrl`. Si se pasa, usa esa imagen
 * en vez del logo default. Acepta `platformName` para mostrar el nombre
 * configurado en vez de "CASINO".
 */

import { DEFAULT_PLATFORM_NAME } from '@/lib/brand';
import { optimizedStorageUrl } from '@/lib/storage-url';

interface BrandWordmarkProps {
  size?: 'sm' | 'md' | 'lg';
  showCasino?: boolean;
  className?: string;
  /** URL del logo del tenant (pisa el default /brand/logo.webp). */
  src?: string | null;
  /** Nombre de la plataforma (se muestra debajo del logo). */
  platformName?: string | null;
}

const SIZES: Record<
  NonNullable<BrandWordmarkProps['size']>,
  { width: number; casino: string }
> = {
  sm: { width: 130, casino: 'text-[10px]' },
  md: { width: 200, casino: 'text-[11px]' },
  lg: { width: 320, casino: 'text-[13px]' },
};

export function BrandWordmark({
  size = 'md',
  showCasino = false,
  className = '',
  src,
  platformName,
}: BrandWordmarkProps) {
  const s = SIZES[size];
  // normalizeStorageUrl convierte URLs cross-origin del worker/Railway a
  // /storage/files/... (rewrite same-origin de Next.js). Sin esto, el browser
  // bloquea la imagen con ERR_BLOCKED_BY_RESPONSE.
  // Se pide REDIMENSIONADO, no crudo. El logo que sube el operador es el
  // archivo original —el de MiamiHub pesa 2,8 MB— y acá se muestra a `s.width`
  // píxeles. Pedirlo al doble del ancho cubre las pantallas retina y lo deja en
  // unos pocos KB. Ver `optimizedStorageUrl`.
  const safeSrc = src
    ? optimizedStorageUrl(src, s.width * 2)
    : '/brand/logo.webp';
  const label = platformName || DEFAULT_PLATFORM_NAME;
  return (
    <span className={`inline-flex flex-col ${className}`} aria-label={label}>
      <img
        src={safeSrc}
        alt={label}
        width={s.width}
        style={{ width: s.width, height: 'auto' }}
        className="block"
        loading="eager"
        fetchPriority="high"
      />
      {platformName ? (
        <span className="mt-1 text-[11px] font-medium text-[var(--color-fg-muted)] text-center">
          {platformName}
        </span>
      ) : showCasino ? (
        <span className="mt-1.5 flex items-center gap-2 text-[var(--color-fg-subtle)]">
          <span className="h-px flex-1 bg-[var(--color-border-strong)]" />
          <span className={`uppercase tracking-[0.4em] ${s.casino}`}>Casino</span>
          <span className="h-px flex-1 bg-[var(--color-border-strong)]" />
        </span>
      ) : null}
    </span>
  );
}
