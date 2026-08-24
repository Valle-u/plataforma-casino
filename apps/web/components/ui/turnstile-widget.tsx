'use client';

/**
 * TurnstileWidget — renderiza el desafío anti-bot de Cloudflare Turnstile y
 * entrega el token al form vía `onToken`. Si Turnstile no está configurado
 * (sin sitekey horneada), no renderiza nada y no interfiere.
 *
 * Usa render EXPLÍCITO (window.turnstile.render) para controlar el ciclo de
 * vida dentro de modales Radix. El script se carga una sola vez por página.
 *
 * Fail-open del lado del cliente: si el script está bloqueado o sin red,
 * `onToken(null)` y el form no se traba — el backend hace fail-open si el
 * token no llega por un problema de infraestructura.
 */

import { useEffect, useRef } from 'react';
import { TURNSTILE_ENABLED, TURNSTILE_SITEKEY } from '@/lib/turnstile';

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  theme?: 'auto' | 'light' | 'dark';
  size?: 'normal' | 'flexible' | 'compact';
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
}

interface TurnstileApi {
  render: (el: HTMLElement, opts: TurnstileRenderOptions) => string;
  remove: (id: string) => void;
  reset: (id?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __turnstileLoading?: Promise<void>;
  }
}

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (window.__turnstileLoading) return window.__turnstileLoading;
  window.__turnstileLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar Turnstile.'));
    document.head.appendChild(s);
  });
  return window.__turnstileLoading;
}

export function TurnstileWidget({
  onToken,
  action,
  className,
}: {
  onToken: (token: string | null) => void;
  action?: string;
  className?: string;
}): React.JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Ref al callback para no re-renderizar el widget si el caller no memoiza.
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!TURNSTILE_ENABLED) return;
    let cancelled = false;
    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        if (widgetIdRef.current) return; // evita doble render (StrictMode)
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITEKEY,
          action,
          theme: 'auto',
          callback: (token: string) => onTokenRef.current(token),
          'error-callback': () => onTokenRef.current(null),
          'expired-callback': () => onTokenRef.current(null),
          'timeout-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        if (!cancelled) onTokenRef.current(null);
      });
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* noop */
        }
        widgetIdRef.current = null;
      }
    };
    // Render una sola vez al montar. `action` es estable por uso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!TURNSTILE_ENABLED) return null;
  return <div ref={containerRef} className={className} />;
}
