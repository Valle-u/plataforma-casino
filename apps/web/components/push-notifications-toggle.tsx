/**
 * PushNotificationsToggle — toggle de notificaciones push por dispositivo.
 *
 * Se monta en /play/settings (panel "player") y /settings (panel "admin").
 * Complementa al banner PushNotificationPrompt: acá el user controla
 * explícitamente la suscripción de ESTE navegador.
 *
 * Estados:
 *   - loading      — leyendo suscripción actual.
 *   - on / off     — suscrito o no (toggleable desde un click: gesto del user).
 *   - denied       — permiso denegado en el navegador (JS no puede re-promptear).
 *   - unsupported  — navegador sin Service Worker / PushManager / Notification.
 *   - unconfigured — el backend no tiene VAPID configurado (aún no disponible).
 *   - error        — falló el subscribe (fail-soft de lib/push).
 */

'use client';

import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import {
  getPushSubscription,
  isPushSupported,
  setPushDismissed,
  subscribeToPush,
  unsubscribePush,
  type PushPanel,
} from '@/lib/push';

type ToggleState =
  | 'loading'
  | 'on'
  | 'off'
  | 'denied'
  | 'unsupported'
  | 'unconfigured'
  | 'error';

export function PushNotificationsToggle({ panel }: { panel: PushPanel }) {
  const [state, setState] = useState<ToggleState>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isPushSupported()) {
        if (!cancelled) setState('unsupported');
        return;
      }
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        if (!cancelled) setState('denied');
        return;
      }
      const sub = await getPushSubscription();
      if (!cancelled) setState(sub ? 'on' : 'off');
    })();
    return () => {
      cancelled = true;
    };
  }, [panel]);

  const checked = state === 'on';

  const handleChange = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        const result = await subscribeToPush();
        if (result.ok) {
          setState('on');
        } else if (result.reason === 'server_not_configured') {
          setState('unconfigured');
        } else if (result.reason === 'failed') {
          setState('error');
        } else {
          setState(result.reason);
        }
      } else {
        await unsubscribePush();
        // Off explícito desde settings → el banner no debe volver a molestar.
        setPushDismissed(panel);
        setState('off');
      }
    } finally {
      setBusy(false);
    }
  };

  const disabled =
    busy ||
    state === 'loading' ||
    state === 'denied' ||
    state === 'unsupported' ||
    state === 'unconfigured';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-[13px] font-medium text-[var(--color-fg)]">
            Notificaciones push
          </span>
          <p className="text-[11px] text-[var(--color-fg-muted)] leading-snug">
            Avisos de depósitos y retiros que llegan para resolver, directo
            en este dispositivo.
          </p>
        </div>
        <Switch
          aria-label="Notificaciones push"
          checked={checked}
          onChange={(next) => void handleChange(next)}
          disabled={disabled}
        />
      </div>

      {state === 'loading' && (
        <p className="text-[11px] text-[var(--color-fg-subtle)] italic">
          Revisando el estado…
        </p>
      )}
      {state === 'on' && (
        <p className="text-[11px] text-[var(--color-success)]">
          Activadas en este dispositivo.
        </p>
      )}
      {state === 'denied' && (
        <p className="text-[11px] text-[var(--color-warning)] leading-snug">
          El navegador denegó el permiso. Para reactivarlas, habilitá las
          notificaciones del sitio desde la configuración del navegador.
        </p>
      )}
      {state === 'unsupported' && (
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          Este navegador no soporta notificaciones push.
        </p>
      )}
      {state === 'unconfigured' && (
        <p className="text-[11px] text-[var(--color-fg-subtle)] leading-snug">
          Las notificaciones push todavía no están disponibles en esta
          plataforma. Volvé a intentarlo más tarde.
        </p>
      )}
      {state === 'error' && (
        <p className="text-[11px] text-[var(--color-warning)] leading-snug">
          No pudimos activarlas. Probá de nuevo.
        </p>
      )}
    </div>
  );
}
