/**
 * /play/games/[code]/play/iframe — juego real de Palace.
 *
 * Sprint 56: removido el mock slot. Todos los juegos son Palace.
 * El provider maneja apuestas/giros dentro de su iframe y nos notifica
 * via callbacks al backend.
 *
 * Flujo:
 *   1. On mount: launch game → recibe sessionId + launchUrl.
 *   2. Embedear launchUrl en iframe a pantalla completa.
 *   3. On unmount / close button: close session.
 *
 * Mobile: el contenedor usa flex vertical; el iframe ocupa todo el viewport
 * disponible y permite fullscreen. En portrait se prioriza la altura real
 * del dispositivo (dvh).
 */

'use client';

import { ArrowLeft, Coins, RotateCcw, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PalaceGameIframe } from '@/components/palace-game-iframe';
import { isApiError } from '@/lib/api-client';
import { useCloseSession, useLaunchGame } from '@/lib/hooks/use-game-session';
import { useGameByCode } from '@/lib/hooks/use-games';
import { useMyWallet } from '@/lib/hooks/use-wallet';

export default function PlayGameIframePage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const game = useGameByCode(code);
  const wallet = useMyWallet();

  const launch = useLaunchGame();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const close = useCloseSession(sessionId);
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // Ref para evitar re-lanzamientos infinitos. useMutation devuelve un
  // nuevo objeto en cada render, lo que causaba que el useEffect se
  // re-ejecutara en cada re-render (wallet polling, etc.) y disparara
  // mutaciones concurrentes que crecían exponencialmente → freeze del
  // browser por spam de 500s.
  const launchAttemptedRef = useRef(false);
  // Ref para cerrar la session al desmontar sin depender de `close`.
  const sessionIdRef = useRef<string | null>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

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

  // Launch on mount (una sola vez).
  useEffect(() => {
    if (!code || launchAttemptedRef.current || !game.data) return;
    doLaunch(code);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, game.data]);

  // Cleanup: cerrar session al desmontar (best-effort).
  useEffect(() => {
    return () => {
      const sid = sessionIdRef.current;
      if (sid) {
        void closeRef.current.mutateAsync().catch(() => {
          /* OK si falla, expira por inactividad eventualmente */
        });
      }
    };
  }, []);

  async function handleClose() {
    if (!sessionId) return;
    try {
      await close.mutateAsync();
      toast.info('Partida cerrada.');
      setSessionId(null);
    } catch {
      toast.error('No se pudo cerrar limpiamente.');
    }
  }

  if (game.isLoading || (launch.isPending && !launchError)) {
    return (
      <div className="flex flex-col h-[100dvh]">
        <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <Skeleton className="h-4 w-24 bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-8 w-28 bg-[var(--color-bg-subtle)]" />
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full bg-[var(--color-bg-subtle)]" />
            <Skeleton className="h-4 w-40 bg-[var(--color-bg-subtle)]" />
          </div>
        </div>
      </div>
    );
  }

  if (game.isError || !game.data) {
    return (
      <div className="h-[100dvh] flex items-center justify-center px-6">
        <EmptyState
          hint="game"
          label="Este juego no está disponible."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href="/play/lobby">
                <ArrowLeft className="size-3.5" />
                Volver al lobby
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const g = game.data;

  if (launchError && !launchUrl) {
    return (
      <div className="flex flex-col h-[100dvh]">
        <header className="flex-none flex items-center justify-between gap-3 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
          <div className="flex items-center gap-2 min-w-0">
            <Link
              href="/play/lobby"
              className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors"
              aria-label="Volver al lobby"
            >
              <ArrowLeft className="size-3.5" />
              <span className="hidden sm:inline">Lobby</span>
            </Link>
            <span className="truncate text-[14px] font-medium text-[var(--color-fg)]">
              {g.name}
            </span>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="flex flex-col items-center gap-4 text-center max-w-sm">
            <p className="text-[14px] text-[var(--color-fg)]">
              {launchError}
            </p>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => code && doLaunch(code)}
                disabled={launch.isPending}
              >
                <RotateCcw className="size-3.5 mr-1.5" />
                Reintentar
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <Link href="/play/lobby">
                  <ArrowLeft className="size-3.5 mr-1.5" />
                  Volver al lobby
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-black">
      {/* Header compacto — sticky arriba */}
      <header className="flex-none flex items-center justify-between gap-3 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/play/lobby"
            className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors"
            aria-label="Volver al lobby"
          >
            <ArrowLeft className="size-3.5" />
            <span className="hidden sm:inline">Lobby</span>
          </Link>
          <span className="truncate text-[14px] font-medium text-[var(--color-fg)]">
            {g.name}
          </span>
          <span className="hidden sm:inline text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-mono">
            {g.category} · {g.providerCode}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-none">
          <div className="flex items-center gap-2 px-2.5 h-8 rounded-[var(--radius)] bg-[var(--color-bg-subtle)]">
            <Coins className="size-3.5 text-[var(--color-accent-text)]" />
            <span className="text-[12px] font-mono tabular-nums text-[var(--color-fg)]">
              {wallet.data?.balance
                ? Number(wallet.data.balance).toLocaleString('es-AR', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })
                : '—'}
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleClose()}
            disabled={close.isPending || !sessionId}
          >
            <X className="size-3" />
            <span className="hidden sm:inline">Cerrar</span>
          </Button>
        </div>
      </header>

      {/* Iframe del juego — ocupa todo el espacio restante */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {launchUrl ? (
          <PalaceGameIframe
            launchUrl={launchUrl}
            gameCode={g.code}
            onError={(err) => toast.error(err)}
            className="w-full h-full"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full bg-[var(--color-bg-subtle)]" />
              <p className="text-[var(--color-fg-muted)] text-[12px]">
                Iniciando partida…
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
