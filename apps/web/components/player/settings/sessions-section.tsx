/**
 * SessionsSection — "Mis dispositivos" del jugador.
 *
 * Lista las sesiones activas del user (GET /tenant/auth/sessions) y permite
 * cerrar sesión en dispositivos remotos (DELETE /tenant/auth/sessions/:id).
 *
 * Reglas:
 *   - La sesión actual se marca "Este dispositivo" y NO se puede revocar
 *     desde acá (el backend responde 409) — para eso está "Cerrar sesión".
 *   - Las sesiones impersonadas se marcan con su badge para que el user
 *     sepa que hay un admin operando con su cuenta.
 */

'use client';

import { Laptop, LogOut, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import {
  type ActiveSession,
  useMySessions,
  useRevokeSession,
} from '@/lib/hooks/use-sessions';

function deviceIcon(label: string) {
  const l = label.toLowerCase();
  const isMobile =
    l.includes('android') || l.includes('ios') || l.includes('iphone');
  const Icon = isMobile ? Smartphone : Laptop;
  return <Icon className="size-4 text-[var(--color-fg-subtle)] shrink-0" />;
}

function formatSince(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SessionsSection() {
  const { data, isLoading } = useMySessions();
  const revoke = useRevokeSession();
  const [target, setTarget] = useState<ActiveSession | null>(null);

  const sessions = data?.sessions ?? [];

  const confirmRevoke = async () => {
    if (!target) return;
    try {
      await revoke.mutateAsync(target.id);
      toast.success('Sesión cerrada', {
        description: `Se cerró la sesión en "${target.deviceLabel}".`,
      });
      setTarget(null);
    } catch (err) {
      toast.error('No se pudo cerrar la sesión', {
        description: isApiError(err) ? err.message : 'Error de conexión.',
      });
    }
  };

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
      <h3 className="mb-1 font-display text-[18px]">Mis dispositivos</h3>
      <p className="mb-4 text-[12px] text-[var(--color-fg-muted)]">
        Las sesiones activas en tu cuenta. Cerrá las que no reconozcas.
      </p>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-14 w-full rounded-[var(--radius)] bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-14 w-full rounded-[var(--radius)] bg-[var(--color-bg-subtle)]" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-[12px] text-[var(--color-fg-subtle)]">
          No hay sesiones activas.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border)]">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                {deviceIcon(s.deviceLabel)}
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="truncate text-[13px] font-medium text-[var(--color-fg)]">
                      {s.deviceLabel}
                    </span>
                    {s.isCurrent && (
                      <Badge variant="success" dot>
                        Este dispositivo
                      </Badge>
                    )}
                    {s.impersonatedBy && (
                      <Badge variant="warning" dot>
                        En uso por un admin
                      </Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-[var(--color-fg-subtle)]">
                    Desde {formatSince(s.createdAt)}
                    {s.ip ? ` · IP ${s.ip}` : ''}
                  </span>
                </div>
              </div>

              {s.isCurrent ? (
                <span className="shrink-0 text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                  Activa
                </span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() => setTarget(s)}
                  disabled={revoke.isPending}
                >
                  <LogOut className="size-3.5" />
                  Cerrar sesión
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={!!target}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title="Cerrar sesión remota"
        description={
          target
            ? `Se cerrará la sesión abierta en "${target.deviceLabel}"${
                target.ip ? ` (IP ${target.ip})` : ''
              }. Necesitará volver a iniciar sesión.`
            : ''
        }
        warning="Tu sesión actual no se ve afectada."
        confirmLabel="Cerrar sesión"
        confirmIcon={<LogOut className="size-3.5" />}
        confirmVariant="outline-accent"
        onConfirm={confirmRevoke}
        isPending={revoke.isPending}
      />
    </section>
  );
}
