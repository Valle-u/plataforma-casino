/**
 * PushNotificationPrompt — banner para activar notificaciones push.
 *
 * Se monta en los layouts autenticados (admin y player). En iOS el
 * permiso de notificación requiere un gesto del user, por eso el
 * banner es un botón explícito (nunca pedimos permiso automático).
 *
 * Reglas de visibilidad:
 *   - No soporta push / permiso denegado / ya desestimado → oculto.
 *   - Permiso ya concedido + ya hay suscripción → oculto (ya está).
 *   - Cualquier otra combinación → muestra el banner.
 */

'use client';

import { useEffect, useState } from 'react';
import {
  getPushSubscription,
  hasPushDismissed,
  isPushSupported,
  setPushDismissed,
  subscribeToPush,
  type PushPanel,
} from '@/lib/push';

export function PushNotificationPrompt({ panel }: { panel: PushPanel }) {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<'idle' | 'subscribing' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isPushSupported() || hasPushDismissed(panel)) return;
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        return;
      }
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const sub = await getPushSubscription();
        if (!cancelled) setVisible(!sub);
        return;
      }
      if (!cancelled) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [panel]);

  if (!visible) return null;

  const handleActivate = async () => {
    setStatus('subscribing');
    const ok = await subscribeToPush();
    if (ok) {
      setVisible(false);
      setStatus('idle');
    } else {
      setStatus('error');
    }
  };

  const handleDismiss = () => {
    setPushDismissed(panel);
    setVisible(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[110] p-3 safe-bottom">
      <div className="mx-auto max-w-md rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-4 shadow-lg">
        <p className="text-sm font-medium text-[var(--color-fg)]">
          Enterate al toque de depósitos y retiros
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-fg-muted)]">
          Activá las notificaciones para que te avisemos cuando llega algo
          para resolver.
        </p>
        {status === 'error' && (
          <p className="mt-2 text-xs text-[var(--color-warning)]">
            No pudimos activarlas. Probá de nuevo o revisá los permisos del
            navegador.
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={handleActivate}
            disabled={status === 'subscribing'}
            className="flex-1 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-[var(--color-accent-fg)] transition-opacity disabled:opacity-60"
          >
            {status === 'subscribing' ? 'Activando…' : 'Activar notificaciones'}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-fg-muted)]"
          >
            Ahora no
          </button>
        </div>
      </div>
    </div>
  );
}
