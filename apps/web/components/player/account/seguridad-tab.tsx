'use client';

/**
 * Tab "Seguridad" de /play/account (docs/21-plan-perfil-wallet.md).
 *
 * Contenido que vivía en /play/settings: banner de exclusión si aplica,
 * 2FA TOTP, cambio de contraseña, cierre de sesión y dispositivos activos.
 */

import { KeyRound, Lock, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChangeMyPasswordModal } from '@/components/admin/change-my-password-modal';
import { TwoFaFlow } from '@/components/player/settings/two-fa-flow';
import { SessionsSection } from '@/components/player/settings/sessions-section';
import { useAuth } from '@/lib/auth-context';
import {
  useMyResponsibleGaming,
  type SelfExclusion,
} from '@/lib/hooks/use-responsible-gaming';

export function SeguridadTab() {
  const rg = useMyResponsibleGaming();

  return (
    <div className="flex flex-col gap-4">
      {rg.data?.exclusion && <ExclusionBanner exclusion={rg.data.exclusion} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SeguridadSection />
        <SessionsSection />
      </div>
    </div>
  );
}

function SeguridadSection() {
  const { user, logout } = useAuth();
  const twoFa = !!user?.twoFaEnabled;
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
      <h3 className="mb-4 font-display text-[18px]">Seguridad</h3>
      <div className="flex flex-col gap-4">
        {/* 2FA (setup/disable/regenerar códigos) */}
        <TwoFaFlow enabled={twoFa} />

        <div className="h-px bg-[var(--color-border)]" />

        {/* Cambiar contraseña (self-service) */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-[var(--color-fg)]">
              Contraseña
            </span>
            <span className="text-[11px] text-[var(--color-fg-subtle)]">
              Cambiá tu contraseña de acceso. Exige la actual.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setChangePwdOpen(true)}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 text-[13px] font-medium text-[var(--color-fg)] transition-colors hover:bg-[var(--color-bg-hover)] hover:border-[var(--color-border-strong)]"
          >
            <KeyRound className="size-3.5" />
            Cambiar
          </button>
        </div>

        <div className="h-px bg-[var(--color-border)]" />

        {/* Cerrar sesión (real) */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-[var(--color-fg)]">
              Sesión
            </span>
            <span className="text-[11px] text-[var(--color-fg-subtle)]">
              Cerrá tu sesión en este dispositivo.
            </span>
          </div>
          <button
            type="button"
            onClick={() => logout('/play/login')}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[var(--radius)] border border-[color:color-mix(in_srgb,var(--color-danger)_45%,transparent)] px-4 text-[13px] font-medium text-[var(--color-danger)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--color-danger)_12%,transparent)]"
          >
            <LogOut className="size-3.5" />
            Cerrar sesión
          </button>
        </div>
      </div>

      <ChangeMyPasswordModal
        open={changePwdOpen}
        onOpenChange={setChangePwdOpen}
      />
    </section>
  );
}

function ExclusionBanner({ exclusion }: { exclusion: SelfExclusion }) {
  const until =
    exclusion.endsAt === null
      ? 'permanente'
      : new Date(exclusion.endsAt).toLocaleString('es-AR', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  return (
    <div className="flex items-start gap-3 p-4 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)]">
      <Lock className="size-4 text-[var(--color-accent-text)] shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-[var(--color-fg)]">
            Tu cuenta está bloqueada
          </span>
          <Badge variant="danger" dot>
            {exclusion.type === 'cool_off'
              ? 'cool-off'
              : exclusion.type === 'temporary'
                ? 'temporal'
                : 'permanente'}
          </Badge>
        </div>
        <p className="text-[12px] text-[var(--color-fg-muted)] leading-relaxed">
          Vigente hasta: <span className="font-mono">{until}</span>. No podés
          depositar ni operar mientras esté activa. Si querés levantar el
          bloqueo antes, contactá a soporte —{' '}
          <span className="text-[var(--color-fg-subtle)]">
            la auto-exclusión NO puede ser revertida por vos mismo.
          </span>
        </p>
      </div>
    </div>
  );
}
