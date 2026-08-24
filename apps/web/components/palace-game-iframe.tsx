/**
 * PalaceGameIframe — iframe fullscreen para juegos de Palace.
 *
 * El componente es lo más simple posible: solo renderiza el iframe con
 * loading state y error state. Los controles (fullscreen, back, close)
 * los maneja el componente padre (game-modal.tsx o iframe/page.tsx).
 *
 * `GameLoadingScreen` se exporta aparte para que el PADRE muestre EXACTAMENTE
 * la misma pantalla mientras pide el launchUrl a Palace — así el jugador ve UNA
 * sola pantalla de carga continua (pedido del link → carga del iframe → juego),
 * sin el salto entre dos loaders distintos.
 *
 * NOTA: NO damos permiso "fullscreen" al iframe. Si el juego lo necesita,
 * lo manejamos en el parent (hacemos fullscreen del modal/page completa).
 * Esto evita que el iframe se superponga sobre nuestros controles HUD.
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
  /** Nombre lindo del juego (para la pantalla de carga). Opcional. */
  gameName?: string;
  /** Thumbnail del juego (para la pantalla de carga). Opcional. */
  thumbnailUrl?: string;
  /** Callback cuando el juego carga exitosamente */
  onLoaded?: () => void;
  /** Callback cuando hay un error cargando el juego */
  onError?: (error: string) => void;
  /** Clases CSS adicionales */
  className?: string;
}

/**
 * Pantalla de carga del juego (cover completo, `absolute inset-0`). Se usa tanto
 * en el PADRE (mientras se pide el launchUrl) como acá (mientras carga el
 * iframe) para que sea una sola experiencia continua.
 */
export function GameLoadingScreen({
  gameName,
  thumbnailUrl,
}: {
  gameName?: string;
  thumbnailUrl?: string;
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
      style={{ background: '#0a0008' }}
    >
      {/* Glow radial que respira, con el color del casino */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--color-accent) 20%, transparent), transparent 62%)',
          animation: 'pgi-breathe 3s ease-in-out infinite',
        }}
      />
      <div className="relative flex flex-col items-center gap-5 px-6 text-center">
        {thumbnailUrl ? (
          // Thumbnail del juego flotando, con un anillo girando alrededor.
          <div className="relative">
            <img
              src={thumbnailUrl}
              alt={gameName ?? 'juego'}
              style={{
                width: 96,
                height: 96,
                borderRadius: 18,
                objectFit: 'cover',
                boxShadow:
                  '0 0 34px color-mix(in srgb, var(--color-accent) 45%, transparent)',
                animation: 'pgi-float 2.6s ease-in-out infinite',
              }}
            />
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: -6,
                borderRadius: 22,
                border: '2px solid transparent',
                borderTopColor: 'var(--color-accent)',
                borderRightColor: 'var(--color-accent)',
                animation: 'pgi-spin 1s linear infinite',
              }}
            />
          </div>
        ) : (
          // Loader con anillo + glow + punto central pulsante.
          <div className="relative" style={{ width: 56, height: 56 }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: '3px solid rgba(255,255,255,0.08)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: '3px solid transparent',
                borderTopColor: 'var(--color-accent)',
                borderRightColor: 'var(--color-accent)',
                filter: 'drop-shadow(0 0 6px var(--color-accent))',
                animation: 'pgi-spin 0.9s cubic-bezier(0.5,0.1,0.5,0.9) infinite',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--color-accent)',
                  animation: 'pgi-pulse 1.4s ease-in-out infinite',
                }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col items-center gap-1">
          {gameName && (
            <p className="text-white font-semibold text-[15px] leading-tight">
              {gameName}
            </p>
          )}
          <p className="text-white/45 text-[12.5px] tracking-wide">
            Preparando tu juego…
          </p>
        </div>

        {/* Barra de progreso indeterminada */}
        <div
          style={{
            marginTop: 2,
            height: 3,
            width: 168,
            borderRadius: 9999,
            background: 'rgba(255,255,255,0.08)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: '45%',
              borderRadius: 9999,
              background: 'var(--color-accent)',
              animation: 'pgi-slide 1.3s ease-in-out infinite',
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes pgi-spin { to { transform: rotate(360deg); } }
        @keyframes pgi-breathe { 0%,100% { opacity: .45 } 50% { opacity: 1 } }
        @keyframes pgi-pulse { 0%,100% { transform: scale(1); opacity: .6 } 50% { transform: scale(1.7); opacity: 1 } }
        @keyframes pgi-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        @keyframes pgi-slide { 0% { transform: translateX(-130%) } 100% { transform: translateX(360%) } }
      `}</style>
    </div>
  );
}

export function PalaceGameIframe({
  launchUrl,
  gameCode,
  gameName,
  thumbnailUrl,
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
      {/* Loading overlay — misma pantalla que muestra el padre, se desvanece
          cuando el iframe termina de cargar. */}
      {isLoading && (
        <GameLoadingScreen gameName={gameName} thumbnailUrl={thumbnailUrl} />
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
        allow="autoplay; gamepad; microphone; camera; clipboard-read; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-storage-access-by-user-activation allow-downloads"
      />
    </div>
  );
}
