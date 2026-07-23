/**
 * GameModal — modal fullscreen para jugar en desktop.
 *
 * Renderiza el juego de Palace en un modal casi-fullscreen (92vw × 92vh)
 * con barra flotante que se auto-oculta. Diseñado para que la experiencia
 * en desktop sea como una "ventana de juego" sin salir del lobby.
 *
 * Props:
 *   - gameCode: código del juego a lanzar
 *   - open / onOpenChange: control del modal (Radix Dialog)
 *
 * Lifecycle:
 *   1. Al abrir: lanza el juego (POST /launch), crea session.
 *   2. Al cerrar o desmontar: cierra la session (POST /close).
 *   3. Fullscreen: entra en fullscreen del elemento del modal (no document).
 */

'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Coins, Maximize, Minimize, X } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { PalaceGameIframe } from '@/components/palace-game-iframe';
import { isApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { useCloseSession, useLaunchGame } from '@/lib/hooks/use-game-session';
import { useGameByCode } from '@/lib/hooks/use-games';
import { useMyWallet } from '@/lib/hooks/use-wallet';

const HUD_HIDE_DELAY = 4000;

const arsFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

interface GameModalProps {
  gameCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function GameModalInner({ gameCode, open, onOpenChange }: GameModalProps) {
  const game = useGameByCode(gameCode);
  const wallet = useMyWallet();
  const launch = useLaunchGame();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const close = useCloseSession(sessionId);
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const launchAttemptedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  // HUD visibility
  const [hudVisible, setHudVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const resetHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setHudVisible(true);
    hideTimerRef.current = setTimeout(() => setHudVisible(false), HUD_HIDE_DELAY);
  }, []);

  // Detect fullscreen on the content element
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Reset state when modal opens with a new game
  useEffect(() => {
    if (open) {
      setLaunchUrl(null);
      setLaunchError(null);
      setSessionId(null);
      launchAttemptedRef.current = false;
      sessionIdRef.current = null;
      setHudVisible(true);
    }
  }, [open, gameCode]);

  // Launch game when modal opens
  useEffect(() => {
    if (!open || !game.data || launchAttemptedRef.current) return;
    launchAttemptedRef.current = true;
    setLaunchError(null);

    void launch.mutateAsync(gameCode).then(
      (res) => {
        setSessionId(res.sessionId);
        sessionIdRef.current = res.sessionId;
        setLaunchUrl(res.launchUrl);
        resetHideTimer();
      },
      (err) => {
        launchAttemptedRef.current = false;
        let msg = 'No se pudo iniciar la partida.';
        if (isApiError(err) && err.code === 'USER_EXCLUDED') {
          msg = 'Tu cuenta está bloqueada por auto-exclusión.';
        } else if (isApiError(err)) {
          msg = err.message || msg;
        }
        setLaunchError(msg);
      },
    );
  }, [open, game.data, gameCode, launch, resetHideTimer]);

  // Cleanup: close session on unmount
  useEffect(() => {
    return () => {
      const sid = sessionIdRef.current;
      if (sid) {
        void closeRef.current.mutateAsync().catch(() => {});
      }
    };
  }, []);

  const handleClose = useCallback(async () => {
    if (sessionId) {
      try {
        await close.mutateAsync();
      } catch {
        // Best-effort
      }
    }
    onOpenChange(false);
  }, [sessionId, close, onOpenChange]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (contentRef.current) {
        await contentRef.current.requestFullscreen();
      }
    } catch {
      // Denied
    }
  }, []);

  const handleInteract = useCallback(() => {
    resetHideTimer();
  }, [resetHideTimer]);

  // Cleanup session when modal closes
  useEffect(() => {
    if (!open && sessionIdRef.current) {
      void closeRef.current.mutateAsync().catch(() => {});
      sessionIdRef.current = null;
      setSessionId(null);
    }
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
        <Dialog.Content
          ref={contentRef}
          onPointerDown={handleInteract}
          className={cn(
            'fixed z-50 bg-black overflow-hidden',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            // Desktop: large modal
            'sm:left-[4vw] sm:top-[4vh] sm:right-[4vw] sm:bottom-[4vh] sm:rounded-xl sm:border sm:border-white/10',
            // Mobile: full screen
            'left-0 top-0 right-0 bottom-0 sm:auto',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          {/* ── HUD flotante ── */}
          <div
            className={cn(
              'absolute inset-x-0 top-0 z-30 transition-all duration-300 ease-out',
              hudVisible
                ? 'translate-y-0 opacity-100'
                : '-translate-y-full opacity-0 pointer-events-none',
            )}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4 sm:py-3 bg-gradient-to-b from-black/80 via-black/50 to-transparent">
              {/* Game name */}
              <div className="flex-1 min-w-0">
                <Dialog.Title className="text-[14px] font-medium text-white truncate">
                  {game.data?.name ?? gameCode}
                </Dialog.Title>
              </div>

              {/* Balance */}
              <div className="flex items-center gap-1.5 px-3 h-8 rounded-full bg-white/10 backdrop-blur-sm">
                <Coins className="size-3.5 text-[var(--color-gold)]" />
                <span className="text-[12px] font-mono tabular-nums text-white">
                  {wallet.data?.balance
                    ? arsFmt.format(Number(wallet.data.balance))
                    : '—'}
                </span>
              </div>

              {/* Fullscreen */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleFullscreen();
                }}
                className="flex items-center justify-center size-9 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/25 text-white transition-colors"
                aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
              >
                {isFullscreen ? (
                  <Minimize className="size-4" />
                ) : (
                  <Maximize className="size-4" />
                )}
              </button>

              {/* Close */}
              <Dialog.Close
                className="flex items-center justify-center size-9 rounded-full bg-white/10 hover:bg-red-500/30 active:bg-red-500/40 text-white transition-colors"
                aria-label="Cerrar juego"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleClose();
                }}
              >
                <X className="size-4" />
              </Dialog.Close>
            </div>
          </div>

          {/* ── Bottom gradient hint ── */}
          {!hudVisible && (
            <div className="absolute top-0 inset-x-0 h-10 bg-gradient-to-b from-white/5 to-transparent z-20 pointer-events-none animate-pulse" />
          )}

          {/* ── Contenido del juego ── */}
          <div className="absolute inset-0">
            {game.isLoading || (launch.isPending && !launchError) ? (
              <div className="flex h-full items-center justify-center bg-[#0a0008]">
                <div className="flex flex-col items-center gap-4">
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
                    Iniciando partida…
                  </p>
                </div>
              </div>
            ) : launchError ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#0a0008] px-6">
                <p className="text-white/80 text-[14px] text-center max-w-sm">
                  {launchError}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    launchAttemptedRef.current = false;
                    setLaunchError(null);
                    if (game.data) {
                      void launch.mutateAsync(gameCode).then(
                        (res) => {
                          setSessionId(res.sessionId);
                          sessionIdRef.current = res.sessionId;
                          setLaunchUrl(res.launchUrl);
                          resetHideTimer();
                        },
                        (err) => {
                          let msg = 'No se pudo iniciar la partida.';
                          if (isApiError(err)) msg = err.message || msg;
                          setLaunchError(msg);
                        },
                      );
                    }
                  }}
                  className="inline-flex items-center gap-2 px-5 h-10 rounded-[var(--radius)] text-[13px] font-medium transition-colors"
                  style={{ background: 'var(--gradient-accent)', color: 'var(--color-accent-fg)' }}
                >
                  Reintentar
                </button>
              </div>
            ) : launchUrl ? (
              <PalaceGameIframe
                launchUrl={launchUrl}
                gameCode={gameCode}
                onError={(err) => toast.error(err)}
                className="w-full h-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-[#0a0008]">
                <p className="text-white/40 text-[12px]">Cargando…</p>
              </div>
            )}
          </div>

          {/* Screen reader only */}
          <Dialog.Description className="sr-only">
            Jugar {game.data?.name ?? gameCode}
          </Dialog.Description>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Memoized: solo re-renderiza si el gameCode o open cambian.
 * El wallet y game query se actualizan internamente sin causar
 * re-renders del modal completo.
 */
export const GameModal = memo(GameModalInner);
