/**
 * PalaceGameIframe — componente para embedear juegos de Palace en un iframe.
 *
 * Cuando el usuario abre un juego de Palace, el backend devuelve una URL
 * de Palace que contiene el juego real. Este componente simplemente
 * embedea esa URL en un iframe.
 *
 * El juego maneja las apuestas internamente (via callbacks a nuestro backend).
 * El frontend no necesita interactuar con el juego - solo mostrarlo.
 */

'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

interface PalaceGameIframeProps {
  /** URL del juego de Palace devuelta por /tenant/games/code/:code/launch */
  launchUrl: string;
  /** Código del juego para el title del iframe */
  gameCode: string;
  /** Callback cuando el juego carga exitosamente */
  onLoaded?: () => void;
  /** Callback cuando hay un error cargando el juego */
  onError?: (error: string) => void;
  /** Clases CSS adicionales */
  className?: string;
}

export function PalaceGameIframe({
  launchUrl,
  gameCode,
  onLoaded,
  onError,
  className,
}: PalaceGameIframeProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    // Reset states when launchUrl changes
    setIsLoading(true);
    setHasError(false);
  }, [launchUrl]);

  function handleLoad() {
    setIsLoading(false);
    onLoaded?.();
  }

  function handleError() {
    setIsLoading(false);
    setHasError(true);
    onError?.('No se pudo cargar el juego. Intentá de nuevo.');
  }

  if (hasError) {
    return (
      <div className={cn(
        'flex flex-col items-center justify-center gap-4 p-8',
        'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
        className,
      )}>
        <div className="text-center">
          <p className="text-[var(--color-fg)] font-medium">
            Error al cargar el juego
          </p>
          <p className="text-[var(--color-fg-muted)] text-[13px] mt-1">
            No se pudo conectar con el proveedor. Intentá de nuevo.
          </p>
        </div>
        <button
          onClick={() => {
            setHasError(false);
            setIsLoading(true);
            // Force iframe reload
            const iframe = document.querySelector(`iframe[data-game="${gameCode}"]`) as HTMLIFrameElement;
            if (iframe) {
              iframe.src = launchUrl;
            }
          }}
          className="px-4 py-2 bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-hover)] transition-colors text-[13px]"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className={cn('relative w-full h-full', className)}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-bg-elevated)]">
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full bg-[var(--color-bg-subtle)]" />
            <p className="text-[var(--color-fg-muted)] text-[12px]">
              Cargando juego...
            </p>
          </div>
        </div>
      )}
      <iframe
        data-game={gameCode}
        src={launchUrl}
        title={gameCode}
        onLoad={handleLoad}
        onError={handleError}
        className={cn(
          'w-full h-full border-0',
          isLoading && 'opacity-0',
        )}
        allow="autoplay; fullscreen; gamepad"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
    </div>
  );
}
