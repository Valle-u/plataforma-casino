/**
 * /play/games/[code]/play/iframe — Game fullscreen con HUD flotante.
 *
 * Diseño: el juego ocupa el 100% del viewport. Los controles (back,
 * saldo, fullscreen) son una barra flotante semi-transparente que se
 * auto-oculta después de 3 segundos. Tocar/clickear el área del juego
 * la vuelve a mostrar.
 *
 * Mobile: dvh para viewport real, safe-area padding para notch,
 * controles grandes para touch. El bottom nav y app bar NO se renderizan
 * (el layout los oculta para esta ruta).
 *
 * Desktop: misma barra flotante pero con más aire. Sidebar y top header
 * ocultos por el layout.
 */

'use client';

import { ArrowLeft, Coins, LogIn, Maximize, Minimize, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PalaceGameIframe } from '@/components/palace-game-iframe';
import { isApiError } from '@/lib/api-client';
import { useCloseSession, useLaunchGame } from '@/lib/hooks/use-game-session';
import { useGameByCode } from '@/lib/hooks/use-games';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { cn } from '@/lib/cn';

/** Milliseconds before the HUD auto-hides. */
const HUD_HIDE_DELAY = 3500;

const arsFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export default function PlayGameIframePage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const game = useGameByCode(code);
  const wallet = useMyWallet();
  const router = useRouter();

  const launch = useLaunchGame();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const close = useCloseSession(sessionId);
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isUnauthenticated, setIsUnauthenticated] = useState(false);

  // Ref para evitar re-lanzamientos infinitos.
  const launchAttemptedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  // ── HUD visibility ──
  const [hudVisible, setHudVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setHudVisible(true);
    hideTimerRef.current = setTimeout(() => setHudVisible(false), HUD_HIDE_DELAY);
  }, []);

  // Detect fullscreen changes
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Start hide timer on mount and when game loads
  useEffect(() => {
    if (launchUrl) resetHideTimer();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [launchUrl, resetHideTimer]);

  // ── Launch logic ──
  const doLaunch = useCallback(
    (gameCode: string) => {
      if (launchAttemptedRef.current) return;
      setLaunchError(null);
      launchAttemptedRef.current = true;
      void launch.mutateAsync(gameCode).then(
        (res) => {
          setSessionId(res.sessionId);
          sessionIdRef.current = res.sessionId;
          setLaunchUrl(res.launchUrl);
        },
        (err) => {
          launchAttemptedRef.current = false;
          let msg = 'No se pudo iniciar la partida.';
          if (isApiError(err) && err.code === 'USER_EXCLUDED') {
            msg = 'Tu cuenta está bloqueada por auto-exclusión.';
          } else if (isApiError(err) && err.status === 401) {
            setIsUnauthenticated(true);
            msg = 'Iniciá sesión o registrate para jugar.';
          } else if (isApiError(err)) {
            msg = err.message || msg;
          }
          setLaunchError(msg);
          toast.error(msg);
        },
      );
    },
    [launch],
  );

  // Launch on mount — no need to wait for game.data, backend resolves it.
  useEffect(() => {
    if (!code || launchAttemptedRef.current) return;
    doLaunch(code);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Cleanup: cerrar session al desmontar
  useEffect(() => {
    return () => {
      const sid = sessionIdRef.current;
      if (sid) {
        void closeRef.current.mutateAsync().catch(() => {});
      }
    };
  }, []);

  async function handleClose() {
    if (!sessionId) return;
    try {
      await close.mutateAsync();
      toast.info('Partida cerrada.');
      setSessionId(null);
      window.location.href = '/play/lobby';
    } catch {
      toast.error('No se pudo cerrar limpiamente.');
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        const el = document.documentElement;
        await el.requestFullscreen();
        // Try landscape lock on mobile
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const orientation = (screen as any).orientation as { lock?: (o: string) => Promise<void> } | undefined;
          if (orientation?.lock) {
            await orientation.lock('landscape').catch(() => {});
          }
        } catch {
          // Some browsers don't support orientation lock
        }
      }
    } catch {
      // Fullscreen may be denied
    }
  }

  // ── Tap handler: show HUD on interaction ──
  function handleInteract() {
    resetHideTimer();
  }

  // ── Loading state (launch in progress, game data optional) ──
  if (launch.isPending && !launchError) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-black">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-full bg-white/10" />
          <p className="text-[13px] text-white/50">Iniciando partida…</p>
        </div>
      </div>
    );
  }

  // ── Game not found (only on actual error, not loading) ──
  if (game.isError) {
    return (
      <div className="flex h-[100dvh] items-center justify-center px-6 bg-black">
        <EmptyState
          hint="game"
          label="Este juego no está disponible."
          action={
            <Link
              href="/play/lobby"
              className="inline-flex items-center gap-2 px-4 h-10 bg-white/10 text-white rounded-[var(--radius)] hover:bg-white/20 transition-colors text-[13px]"
            >
              <ArrowLeft className="size-3.5" />
              Volver al lobby
            </Link>
          }
        />
      </div>
    );
  }

  const g = game.data;

  // ── HUD: show game name when available, fallback to code ──
  const displayName = g?.name ?? code;

  // Saldo total jugable = (balance − locked) + bono. El backend descuenta
  // primero del bono (placeBetWithBonus) y valida contra el balance DISPONIBLE
  // (el locked por retiros pendientes no es apostable, LEYES E6). El HUD debe
  // reflejar la misma semántica para que el jugador vea lo que realmente
  // puede apostar.
  const totalBalance =
    wallet.data?.balance == null
      ? null
      : Math.max(0, Number(wallet.data.balance) - Number(wallet.data.lockedBalance ?? '0')) +
        Number(wallet.data.bonusBalance ?? '0');
  const bonusBalanceNum = Number(wallet.data?.bonusBalance ?? '0');
  const hasBonus = bonusBalanceNum > 0;

  // ── Launch error ──
  if (launchError && !launchUrl) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center px-6 bg-black gap-6">
        <p className="text-[14px] text-white/80 text-center max-w-sm">{launchError}</p>
        <div className="flex items-center gap-3">
          {isUnauthenticated ? (
            <button
              type="button"
              onClick={() => router.push('/play/login')}
              className="inline-flex items-center gap-2 px-5 h-10 rounded-[var(--radius)] text-[13px] font-medium transition-colors"
              style={{ background: 'var(--gradient-accent)', color: 'var(--color-accent-fg)' }}
            >
              <LogIn className="size-3.5" />
              Iniciar sesión
            </button>
          ) : (
            <button
              type="button"
              onClick={() => code && doLaunch(code)}
              disabled={launch.isPending}
              className="inline-flex items-center gap-2 px-5 h-10 rounded-[var(--radius)] text-[13px] font-medium transition-colors"
              style={{ background: 'var(--gradient-accent)', color: 'var(--color-accent-fg)' }}
            >
              Reintentar
            </button>
          )}
          <Link
            href="/play/lobby"
            className="inline-flex items-center gap-2 px-5 h-10 rounded-[var(--radius)] bg-white/10 text-white hover:bg-white/20 transition-colors text-[13px]"
          >
            <ArrowLeft className="size-3.5" />
            Volver
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative h-[100dvh] w-full overflow-hidden bg-black select-none"
      onPointerDown={handleInteract}
      onClick={handleInteract}
    >
      {/* ── Iframe del juego — ocupa TODO ── */}
      <div className="absolute inset-0">
        {launchUrl ? (
          <PalaceGameIframe
            launchUrl={launchUrl}
            gameCode={code}
            gameName={displayName}
            thumbnailUrl={g?.thumbnailUrl ?? undefined}
            onError={(err) => toast.error(err)}
            className="w-full h-full"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <Skeleton className="h-12 w-12 rounded-full bg-white/10" />
              <p className="text-white/50 text-[13px]">Iniciando partida…</p>
            </div>
          </div>
        )}
      </div>

      {/* ── HUD: barra de info (auto-hide) ── */}
      <div
        className={cn(
          'absolute inset-x-0 top-0 z-[150] transition-all duration-300 ease-out',
          hudVisible
            ? 'translate-y-0 opacity-100'
            : '-translate-y-full opacity-0 pointer-events-none',
        )}
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <div className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 bg-gradient-to-b from-black/90 via-black/60 to-transparent">
          {/* Back */}
          <Link
            href="/play/lobby"
            className="flex items-center justify-center size-10 sm:size-9 rounded-full bg-black/50 hover:bg-white/20 active:bg-white/25 text-white transition-colors backdrop-blur-sm border border-white/10"
            aria-label="Volver al lobby"
            onClick={(e) => e.stopPropagation()}
          >
            <ArrowLeft className="size-5 sm:size-4" />
          </Link>

          {/* Center: game name + balance */}
          <div className="flex-1 flex items-center justify-center gap-3 min-w-0">
            <span className="text-[13px] sm:text-[14px] font-medium text-white truncate max-w-[140px] sm:max-w-none">
              {displayName}
            </span>
            <div className="flex items-center gap-1.5 px-3 h-8 rounded-full bg-black/50 backdrop-blur-sm border border-white/10">
              <Coins className="size-3.5 text-[var(--color-gold)]" />
              <span className="text-[12px] sm:text-[13px] font-mono tabular-nums text-white">
                {totalBalance != null ? arsFmt.format(totalBalance) : '—'}
              </span>
              {hasBonus && (
                <span className="hidden sm:inline text-[10px] font-medium text-white/60 whitespace-nowrap">
                  incluye ${arsFmt.format(bonusBalanceNum)} bono
                </span>
              )}
            </div>
          </div>

          {/* Spacer for the action buttons (they sit on top) */}
          <div className="w-[88px] sm:w-[80px]" />
        </div>
      </div>

      {/* ── HUD: botones de acción (SIEMPRE visibles) ── */}
      <div
        className="absolute top-0 right-0 z-[200] flex items-center gap-1.5 p-2 sm:p-2.5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void toggleFullscreen();
          }}
          className="flex items-center justify-center size-10 sm:size-10 rounded-full bg-black/70 hover:bg-white/25 active:bg-white/30 text-white backdrop-blur-md border border-white/15 transition-colors shadow-lg"
          aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
        >
          {isFullscreen ? (
            <Minimize className="size-5" />
          ) : (
            <Maximize className="size-5" />
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleClose();
          }}
          className="flex items-center justify-center size-10 sm:size-10 rounded-full bg-black/70 hover:bg-red-500/40 active:bg-red-500/50 text-white backdrop-blur-md border border-white/15 transition-colors shadow-lg"
          aria-label="Cerrar partida"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* ── Bottom glow hint ── */}
      {!hudVisible && (
        <div className="absolute top-0 inset-x-0 h-12 bg-gradient-to-b from-white/5 to-transparent z-20 pointer-events-none animate-pulse" />
      )}
    </div>
  );
}
