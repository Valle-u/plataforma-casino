/**
 * /play/games/[code]/play/iframe — mini-slot mock interactivo (Sprint 35).
 *
 * Versión MVP del mock game: 3 reels, spin button, balance display, history
 * de los últimos rounds. Sin animaciones complejas (CSS scale on win).
 *
 * Flujo:
 *   1. On mount: launch game → recibe sessionId.
 *   2. Spin: POST bet → recibe round con payload.reels + win/loss.
 *   3. Render reels del payload + flash de win.
 *   4. On unmount / close button: close session.
 *
 * Si user excluded / sin saldo / fuera de rango: toast con mensaje claro.
 */

'use client';

import {
  ArrowLeft,
  Coins,
  History,
  Play,
  Square,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import {
  useCloseSession,
  useLaunchGame,
  usePlaceBet,
  useSessionRounds,
  type GameRound,
} from '@/lib/hooks/use-game-session';
import { useGameByCode } from '@/lib/hooks/use-games';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { soundClaim, soundJackpot, soundSpinTick } from '@/lib/sounds';
import { cn } from '@/lib/cn';

const PLACEHOLDER_REELS = ['🎰', '🎰', '🎰'];

export default function PlayGameIframePage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const game = useGameByCode(code);
  const wallet = useMyWallet();

  const launch = useLaunchGame();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [betInput, setBetInput] = useState<string>('1');
  const [lastRound, setLastRound] = useState<GameRound | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const placeBet = usePlaceBet(sessionId);
  const close = useCloseSession(sessionId);
  const history = useSessionRounds(sessionId, 20);

  const minBet = useMemo(
    () =>
      game.data?.config && typeof game.data.config.minBet === 'string'
        ? game.data.config.minBet
        : '1',
    [game.data],
  );
  const maxBet = useMemo(
    () =>
      game.data?.config && typeof game.data.config.maxBet === 'string'
        ? game.data.config.maxBet
        : '500',
    [game.data],
  );

  // Launch on mount (cuando game.data está disponible).
  useEffect(() => {
    if (!code || sessionId || !game.data) return;
    let cancelled = false;
    void launch.mutateAsync(code).then(
      (res) => {
        if (cancelled) return;
        setSessionId(res.sessionId);
        setBetInput(minBet);
      },
      (err) => {
        if (cancelled) return;
        if (isApiError(err) && err.code === 'USER_EXCLUDED') {
          toast.error('Tu cuenta está bloqueada por auto-exclusión.');
        } else if (isApiError(err)) {
          toast.error(err.message || 'No se pudo iniciar la partida.');
        } else {
          toast.error('Error de conexión.');
        }
      },
    );
    return () => {
      cancelled = true;
    };
     
  }, [code, game.data]);

  // Cleanup: cerrar session al desmontar (best-effort).
  useEffect(() => {
    return () => {
      if (sessionId) {
        // Fire-and-forget. Sin await, el unmount no espera.
        void close.mutateAsync().catch(() => {
          /* OK si falla, expira por inactividad eventualmente */
        });
      }
    };
     
  }, []);

  async function handleSpin() {
    if (!sessionId || placeBet.isPending) return;
    // Sprint 51.31: sound tick al iniciar (sutil feedback).
    soundSpinTick();
    try {
      const round = await placeBet.mutateAsync({ amount: betInput });
      setLastRound(round);
      const win = Number(round.winAmount);
      if (win > 0) {
        // Si win >= 10x bet → jackpot sound; sino claim sutil.
        const ratio = win / Number(round.betAmount);
        if (ratio >= 10) soundJackpot();
        else soundClaim();
        toast.success(`¡Ganaste ${formatChips(round.winAmount)} fichas!`);
      }
    } catch (err) {
      handleBetError(err);
    }
  }

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

  if (game.isLoading || launch.isPending) {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-10 flex flex-col gap-6">
        <Skeleton className="h-12 w-64 bg-[var(--color-bg-subtle)]" />
        <Skeleton className="h-[300px] w-full bg-[var(--color-bg-subtle)]" />
      </div>
    );
  }

  if (game.isError || !game.data) {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-10">
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
  const reels =
    lastRound?.payload?.reels && Array.isArray(lastRound.payload.reels)
      ? (lastRound.payload.reels)
      : PLACEHOLDER_REELS;
  const isWin = lastRound ? Number(lastRound.winAmount) > 0 : false;

  return (
    <div className="max-w-[800px] mx-auto px-6 py-10 flex flex-col gap-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link
            href="/play/lobby"
            className="mt-1 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors"
          >
            <ArrowLeft className="size-3" />
            Lobby
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory((v) => !v)}
          >
            <History className="size-3" />
            {showHistory ? 'Ocultar' : 'Ver historial'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClose}
            disabled={close.isPending || !sessionId}
          >
            <X className="size-3" />
            Cerrar partida
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[2rem] leading-none tracking-tight">
          {g.name}
        </h1>
        <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-mono">
          {g.category} · provider mock · RTP{' '}
          {typeof g.config.rtp === 'number'
            ? `${(g.config.rtp * 100).toFixed(0)}%`
            : '95%'}
        </span>
      </div>

      {/* Slot machine — Sprint 51.31 premium polish */}
      <section
        className={cn(
          'relative flex flex-col items-center gap-6 p-8 overflow-hidden',
          'card-premium rounded-[var(--radius-xl)]',
          isWin && 'shadow-[var(--shadow-edge),0_0_0_2px_var(--color-accent),0_0_40px_-4px_var(--color-accent-glow)]',
          'transition-shadow duration-300',
        )}
      >
        {/* Glow behind reels when winning */}
        {isWin && (
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none animate-pulse"
            style={{
              background:
                'radial-gradient(ellipse at center, var(--color-accent-glow) 0%, transparent 60%)',
            }}
          />
        )}
        <div className="relative flex items-center gap-3 sm:gap-4">
          {reels.map((symbol, i) => (
            <div
              key={i}
              className={cn(
                'size-20 sm:size-24 flex items-center justify-center',
                'text-4xl sm:text-5xl rounded-[var(--radius)]',
                'bg-[var(--color-bg)] border border-[var(--color-border-strong)]',
                'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_2px_8px_-2px_rgba(0,0,0,0.5)]',
                placeBet.isPending && 'animate-pulse',
              )}
            >
              {symbol}
            </div>
          ))}
        </div>

        {lastRound && (
          <div className="text-center">
            {isWin ? (
              <p className="text-[var(--color-accent-text)] font-display text-2xl tracking-tight">
                + {formatChips(lastRound.winAmount)} fichas
              </p>
            ) : (
              <p className="text-[var(--color-fg-subtle)] text-[14px]">
                Esta vez no — probá de nuevo
              </p>
            )}
            {typeof lastRound.payload?.multiplier === 'number' &&
              lastRound.payload.multiplier > 0 && (
                <p className="text-[11px] text-[var(--color-fg-muted)] font-mono mt-1">
                  multiplier: {lastRound.payload.multiplier.toFixed(2)}x
                </p>
              )}
          </div>
        )}

        {!lastRound && !placeBet.isPending && (
          <p className="text-[12px] text-[var(--color-fg-muted)] text-center">
            Apostá para girar. Min {minBet}, max {maxBet} fichas.
          </p>
        )}
      </section>

      {/* Controls */}
      <section className="flex flex-col sm:flex-row gap-3 items-end">
        <FormField
          id="bet-amount"
          label="Apuesta (fichas)"
          hint={`Min ${minBet} · max ${maxBet}`}
        >
          <Input
            id="bet-amount"
            type="number"
            inputMode="decimal"
            value={betInput}
            onChange={(e) => setBetInput(e.target.value)}
            min={minBet}
            max={maxBet}
            step="0.01"
            className="font-mono"
            disabled={placeBet.isPending || !sessionId}
          />
        </FormField>
        <div className="flex items-center gap-3 flex-1 justify-end">
          <div className="flex items-center gap-2 px-3 h-10 rounded-[var(--radius)] btn-premium-secondary">
            <Coins className="size-3.5 text-[var(--color-accent-text)]" />
            <span className="text-[12px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
              Saldo
            </span>
            <span className="text-[14px] font-mono tabular-nums text-[var(--color-fg)]">
              {wallet.data?.balance
                ? formatChips(wallet.data.balance)
                : '— · — —'}
            </span>
          </div>
          <Button
            variant="primary"
            size="lg"
            onClick={handleSpin}
            disabled={placeBet.isPending || !sessionId}
          >
            {placeBet.isPending ? (
              <>
                <Square className="size-4 animate-pulse" />
                Girando…
              </>
            ) : (
              <>
                <Play className="size-4" />
                Girar
              </>
            )}
          </Button>
        </div>
      </section>

      {/* History */}
      {showHistory && (
        <section className="flex flex-col gap-3 p-4 card-premium rounded-[var(--radius-lg)]">
          <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
            Últimas tiradas
          </span>
          {history.isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-8 w-full bg-[var(--color-bg-subtle)]"
                />
              ))}
            </div>
          ) : !history.data?.data || history.data.data.length === 0 ? (
            <span className="text-[12px] text-[var(--color-fg-subtle)] italic">
              Sin tiradas todavía.
            </span>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--color-border)]">
              {history.data.data.slice().reverse().map((r) => {
                const net = Number(r.netAmount);
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 py-2 text-[12px]"
                  >
                    <span className="font-mono text-[var(--color-fg-subtle)]">
                      bet {r.betAmount}
                    </span>
                    <span
                      className={cn(
                        'font-mono tabular-nums',
                        net > 0
                          ? 'text-[var(--color-accent-text)]'
                          : net < 0
                            ? 'text-[var(--color-fg-muted)]'
                            : 'text-[var(--color-fg-subtle)]',
                      )}
                    >
                      {net >= 0 ? '+' : ''}
                      {r.netAmount}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function handleBetError(err: unknown): void {
  if (!isApiError(err)) {
    toast.error('Error de conexión.');
    return;
  }
  if (err.code === 'INSUFFICIENT_BALANCE') {
    toast.error('Saldo insuficiente — cargá fichas antes de seguir.');
  } else if (err.code === 'GAME_BET_OUT_OF_RANGE') {
    toast.error('La apuesta está fuera del rango permitido para este juego.');
  } else if (err.code === 'USER_EXCLUDED') {
    toast.error('Tu cuenta está bloqueada por auto-exclusión.');
  } else if (err.code === 'BET_LIMIT_EXCEEDED') {
    toast.error('Excede tu límite por tirada. Ajustalo en Mi cuenta si querés.');
  } else if (err.code === 'LOSS_LIMIT_EXCEEDED') {
    toast.error('Llegaste a tu límite de pérdida del período. Pausa recomendada.');
  } else if (err.code === 'GAME_SESSION_NOT_ACTIVE') {
    toast.error('La partida se cerró. Recargá la página para iniciar una nueva.');
  } else {
    toast.error(err.message || 'No se pudo procesar la apuesta.');
  }
}

function formatChips(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
