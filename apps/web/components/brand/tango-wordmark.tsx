/**
 * TangoWordmark — wordmark de marca de Casino TANGO.
 *
 * Renderiza el logo oficial como imagen, con opción de sublabel "CASINO"
 * debajo. Única fuente de verdad del wordmark — usar en login, header,
 * sidebar y footer para que la marca sea consistente en toda la app.
 */

interface TangoWordmarkProps {
  size?: 'sm' | 'md' | 'lg';
  /** Muestra el sublabel "CASINO" debajo (default true). */
  showCasino?: boolean;
  className?: string;
}

const SIZES: Record<
  NonNullable<TangoWordmarkProps['size']>,
  { width: number; casino: string }
> = {
  sm: { width: 130, casino: 'text-[10px]' },
  md: { width: 200, casino: 'text-[11px]' },
  lg: { width: 320, casino: 'text-[13px]' },
};

export function TangoWordmark({
  size = 'md',
  showCasino = false,
  className = '',
}: TangoWordmarkProps) {
  const s = SIZES[size];
  return (
    <span className={`inline-flex flex-col ${className}`} aria-label="Casino TANGO">
      <img
        src="/brand/logo.webp"
        alt="Casino TANGO"
        width={s.width}
        style={{ width: s.width, height: 'auto' }}
        className="block"
        loading="eager"
        fetchPriority="high"
      />
      {showCasino && (
        <span className="mt-1.5 flex items-center gap-2 text-[var(--color-fg-subtle)]">
          <span className="h-px flex-1 bg-[var(--color-border-strong)]" />
          <span className={`uppercase tracking-[0.4em] ${s.casino}`}>Casino</span>
          <span className="h-px flex-1 bg-[var(--color-border-strong)]" />
        </span>
      )}
    </span>
  );
}
