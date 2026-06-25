/**
 * TangoWordmark — wordmark de marca de Casino TANGO (rediseño "Neón Milonga").
 *
 * Renderiza "TANGO" en Space Grotesk bold con la letra **N** en azul
 * eléctrico + glow, y opcionalmente un sublabel "CASINO" entre dos
 * hairlines. Única fuente de verdad del wordmark — usar en login, header,
 * sidebar y footer para que la marca sea consistente en toda la app.
 *
 * No usa hooks → sirve tanto en server como en client components.
 */

interface TangoWordmarkProps {
  size?: 'sm' | 'md' | 'lg';
  /** Muestra el sublabel "CASINO" debajo (default true). */
  showCasino?: boolean;
  className?: string;
}

const SIZES: Record<
  NonNullable<TangoWordmarkProps['size']>,
  { word: string; casino: string }
> = {
  sm: { word: 'text-[18px]', casino: 'text-[8px]' },
  md: { word: 'text-[22px]', casino: 'text-[9px]' },
  lg: { word: 'text-[32px]', casino: 'text-[10px]' },
};

export function TangoWordmark({
  size = 'md',
  showCasino = true,
  className = '',
}: TangoWordmarkProps) {
  const s = SIZES[size];
  return (
    <span className={`inline-flex flex-col ${className}`} aria-label="Casino TANGO">
      <span
        className={`font-bold leading-none tracking-[0.05em] text-[var(--color-fg)] ${s.word}`}
        style={{ fontFamily: 'var(--font-sans)' }}
      >
        TA
        <span
          className="text-[var(--color-accent)]"
          style={{ textShadow: '0 0 16px rgba(46, 155, 255, 0.7)' }}
        >
          N
        </span>
        GO
      </span>
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
