/**
 * /play error boundary — Sprint 53.3.
 *
 * Captura errores en cualquier ruta del player (lobby, wallet, wheel,
 * etc.) sin tirar el chrome (header + footer + bottom nav siguen).
 *
 * UX premium consistente con el resto de /play: card-premium glass,
 * lenguaje cercano (no "error técnico XYZ"), CTAs accionables.
 *
 * ## Por qué además muestra el detalle técnico
 *
 * Esta pantalla apareció en producción, en un link de referido abierto desde
 * un teléfono, y **no quedó registro en ningún lado**: acá sólo había un
 * `console.error`, y la consola de un celular ajeno no se puede leer. Sentry
 * está inicializado pero en producción arranca sin cliente —el DSN está
 * vacío—, así que tampoco lo recibió.
 *
 * Resultado: el error existió, tumbó la primera pantalla que ve alguien que
 * todavía no tiene cuenta, y no hay forma de saber cuál fue.
 *
 * Por eso el detalle es visible: plegado, en gris, sin ruido para quien no lo
 * busca — pero alcanza con que la persona lo abra y mande una captura. El
 * `captureException` de abajo es el camino bueno y empieza a funcionar solo en
 * cuanto el DSN esté cargado; hasta entonces, esto es lo único que hay.
 */

'use client';

import * as Sentry from '@sentry/nextjs';
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export default function PlayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [verDetalle, setVerDetalle] = useState(false);

  // ── Recuperación de un chunk que no llegó ────────────────────────────────
  //
  // El link de referido se abre casi siempre desde WhatsApp, y en iPhone eso
  // es un `WKWebView` que iOS puede matar por memoria. Si el proceso se cae
  // mientras bajaba uno de los ~15 chunks de `/play`, webpack tira
  // `ChunkLoadError` y esta pantalla lo tapa todo — para alguien que todavía
  // no tiene cuenta, el casino simplemente no abre.
  //
  // No es un error de programa: al bundle no le pasó nada, se cortó la
  // descarga. Recargar lo arregla.
  //
  // ⚠️ **Una sola vez.** El flag en sessionStorage no es opcional: si el chunk
  // faltara de verdad —un deploy que borró el archivo— recargar volvería a
  // fallar, y sin freno serían recargas infinitas. Justo el bucle que se
  // arregló hoy en el layout; no se vuelve a construir acá.
  useEffect(() => {
    const esDeChunk =
      error.name === 'ChunkLoadError' || /Loading chunk|dynamically imported module/i.test(error.message);
    if (!esDeChunk) return;
    try {
      if (window.sessionStorage.getItem('casino:chunk-retry')) return;
      window.sessionStorage.setItem('casino:chunk-retry', '1');
    } catch {
      return; // sin sessionStorage no hay freno → no se recarga
    }
    window.location.reload();
  }, [error]);

  useEffect(() => {
    console.error('[PlayError]', error);
    // Sin DSN esto no hace nada y no tira: cuando el DSN esté, empieza a
    // reportar sin tocar el código.
    Sentry.captureException(error, {
      tags: { boundary: 'play' },
      extra: { digest: error.digest, url: window.location.href },
    });
  }, [error]);

  return (
    <div className="max-w-[600px] mx-auto px-4 sm:px-6 py-12 sm:py-20">
      <div className="card-premium rounded-[var(--radius-xl)] p-6 sm:p-10 flex flex-col gap-5 relative overflow-hidden">
        {/* Glow accent radial sutil */}
        <div
          aria-hidden
          className="absolute -inset-x-12 -top-12 h-48 opacity-40 blur-3xl pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center, var(--color-accent-glow) 0%, transparent 65%)',
          }}
        />

        <div className="relative flex items-center gap-2">
          <AlertTriangle
            className="size-4 text-[var(--color-accent-text)]"
            aria-hidden
          />
          <span className="text-[11px] uppercase tracking-[0.14em] font-medium text-[var(--color-accent-text)]">
            Ups
          </span>
        </div>

        <h1 className="relative font-display text-2xl sm:text-[2.25rem] leading-tight tracking-tight text-[var(--color-fg)]">
          Esto no salió como esperábamos
        </h1>

        <p className="relative text-[13px] sm:text-sm text-[var(--color-fg-muted)] leading-relaxed">
          Hubo un problema cargando esta pantalla. Probá de nuevo en un
          segundo. Si se repite, andá al inicio y abrinos un ticket desde
          Mi cuenta — vamos a revisarlo.
        </p>

        {error.digest && (
          <div className="relative text-[11px] font-mono text-[var(--color-fg-subtle)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] px-3 py-2 rounded-[var(--radius-sm)]">
            Referencia:{' '}
            <span className="text-[var(--color-fg-muted)]">{error.digest}</span>
          </div>
        )}

        {/*
          El detalle técnico, plegado. Un error de cliente casi nunca trae
          `digest` —eso lo pone el servidor—, así que sin esto la persona no
          tiene NADA que reportar más que "me dio Ups".
        */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setVerDetalle((v) => !v)}
            className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-muted)] transition-colors"
          >
            {verDetalle ? 'Ocultar detalle' : 'Ver detalle técnico'}
          </button>
          {verDetalle && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] font-mono text-[var(--color-fg-muted)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] px-3 py-2 rounded-[var(--radius-sm)]">
              {error.name}: {error.message}
            </pre>
          )}
        </div>

        <div className="relative flex items-center gap-2 sm:gap-3 flex-wrap pt-2">
          <Button variant="premium" size="lg" onClick={() => reset()}>
            <RefreshCw className="size-3.5" />
            Reintentar
          </Button>
          <Button variant="premium-ghost" size="lg" asChild>
            <Link href="/play">
              Volver al inicio
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
