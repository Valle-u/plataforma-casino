/**
 * PalaceGameIframe — componente para embedear juegos de Palace en un iframe.
 *
 * Sprint 56: mobile-first. El iframe ocupa el 100% del contenedor padre y
 * permite fullscreen. En móviles se ofrece un botón para forzar orientación
 * landscape / pantalla completa, ya que la mayoría de los juegos de casino
 * están diseñados para apaisado.
 *
 * El juego maneja las apuestas internamente (via callbacks a nuestro backend).
 * El frontend no necesita interactuar con el juego - solo mostrarlo.
 */

'use client';

import { Fullscreen, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
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

  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
  async function enterFullscreen() {
    const el = iframeRef.current;
    if (!el) return;
    try {
      const request = (el as any).requestFullscreen;
      if (request) {
        await request.call(el);
      } else {
        // Safari legacy fallback.
        const webkitRequest = (el as any).webkitRequestFullscreen as
          | (() => Promise<void> | void)
          | undefined;
        if (webkitRequest) {
          await webkitRequest.call(el);
        }
      }
      // Prefer landscape on mobile when available.
      const orientation = (screen as any).orientation;
      if (orientation?.lock) {
        await orientation.lock('landscape').catch(() => {
          // Some devices/browsers don't allow lock — ignore.
        });
      }
    } catch {
      // Fullscreen request may be denied; fail silently.
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */

  function reload() {
    setHasError(false);
    setIsLoading(true);
    const iframe = iframeRef.current;
    if (iframe) {
      iframe.src = launchUrl;
    }
  }

  if (hasError) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-4 p-8',
          'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
          className,
        )}
      >
        <div className="text-center">
          <p className="text-[var(--color-fg)] font-medium">
            Error al cargar el juego
          </p>
          <p className="text-[var(--color-fg-muted)] text-[13px] mt-1">
            No se pudo conectar con el proveedor. Intentá de nuevo.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={reload}>
          <RotateCcw className="size-3.5 mr-1.5" />
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('relative w-full h-full', className)}>
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-bg-elevated)]">
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full bg-[var(--color-bg-subtle)]" />
            <p className="text-[var(--color-fg-muted)] text-[12px]">
              Cargando juego…
            </p>
          </div>
        </div>
      )}

      {/* Fullscreen toggle — siempre visible en móvil, hover/focus en desktop */}
      <button
        type="button"
        onClick={() => void enterFullscreen()}
        className={cn(
          'absolute top-3 right-3 z-20',
          'inline-flex items-center gap-1.5 px-2.5 h-8',
          'rounded-[var(--radius)] bg-black/60 text-white text-[11px]',
          'hover:bg-black/80 focus:bg-black/80',
          'opacity-100 sm:opacity-0 sm:hover:opacity-100 sm:focus:opacity-100',
          'transition-opacity duration-200',
        )}
        aria-label="Pantalla completa"
        title="Pantalla completa"
      >
        <Fullscreen className="size-3.5" />
        <span className="hidden sm:inline">Pantalla completa</span>
      </button>

      <iframe
        ref={iframeRef}
        data-game={gameCode}
        src={launchUrl}
        title={gameCode}
        onLoad={handleLoad}
        onError={handleError}
        className={cn(
          'w-full h-full border-0',
          isLoading && 'opacity-0',
        )}
        allow="autoplay; fullscreen; gamepad; microphone; camera; clipboard-read; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-storage-access-by-user-activation allow-top-navigation-by-user-activation allow-downloads"
      />
    </div>
  );
}
