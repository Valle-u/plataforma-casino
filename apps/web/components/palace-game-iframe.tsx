/**
 * PalaceGameIframe — iframe fullscreen para juegos de Palace.
 *
 * El componente es lo más simple posible: solo renderiza el iframe con
 * loading state y error state. Los controles (fullscreen, back, close)
 * los maneja el componente padre (iframe/page.tsx).
 *
 * Mobile: permite touch + fullscreen API. El iframe usa
 * allow="autoplay; fullscreen" para habilitar las APIs del juego.
 */

'use client';

import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
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
          'bg-[#140a1a] text-white',
          className,
        )}
      >
        <div className="text-center">
          <p className="font-medium text-[15px]">Error al cargar el juego</p>
          <p className="text-white/50 text-[13px] mt-1">
            No se pudo conectar con el proveedor.
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
      {/* Loading overlay — se desvanece cuando el iframe carga */}
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0a0008]">
          <div className="flex flex-col items-center gap-4">
            {/* Spinner elegante: anillo que gira */}
            <div className="relative size-10">
              <div className="absolute inset-0 rounded-full border-2 border-white/10" />
              <div
                className="absolute inset-0 rounded-full border-2 border-transparent"
                style={{
                  borderTopColor: 'var(--color-accent)',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
            </div>
            <p className="text-white/40 text-[12px] tracking-wide">
              Cargando juego…
            </p>
          </div>
        </div>
      )}

      <iframe
        ref={iframeRef}
        data-game={gameCode}
        src={launchUrl}
        title={gameCode}
        onLoad={handleLoad}
        onError={handleError}
        className={cn(
          'w-full h-full border-0 bg-black',
          isLoading && 'opacity-0',
        )}
        allow="autoplay; fullscreen; gamepad; microphone; camera; clipboard-read; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-storage-access-by-user-activation allow-top-navigation-by-user-activation allow-downloads"
      />
    </div>
  );
}
