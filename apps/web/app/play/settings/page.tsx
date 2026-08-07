/**
 * /play/settings — Cuenta del jugador (datos, seguridad, notificaciones,
 * 2FA y dispositivos).
 *
 * Composición:
 *   - ProfileHero: saldo, nivel VIP, volumen apostado, estado 2FA.
 *   - Si hay exclusion activa: banner rojo arriba con tipo + endsAt.
 *     (El user no puede revertir self-exclusion — solo el admin/soporte).
 *   - Datos personales (read-only) + Notificaciones push.
 *   - Seguridad: 2FA TOTP (activar/desactivar/regenerar códigos) +
 *     cambiar contraseña + cerrar sesión.
 *   - Mis dispositivos: sesiones activas con cierre remoto.
 *
 * Backend: /tenant/auth (me/password, 2fa/*, sessions), responsible-gaming.
 */

'use client';

import {
  AtSign,
  Calendar,
  Check,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  Shield,
  User,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChangeMyPasswordModal } from '@/components/admin/change-my-password-modal';
import { PushNotificationsToggle } from '@/components/push-notifications-toggle';
import { TwoFaFlow } from '@/components/player/settings/two-fa-flow';
import { SessionsSection } from '@/components/player/settings/sessions-section';
import { useAuth } from '@/lib/auth-context';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { useVipTier } from '@/lib/hooks/use-vip-tier';
import { useMyResponsibleGaming, type SelfExclusion } from '@/lib/hooks/use-responsible-gaming';

const arsFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2)
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

export default function PlaySettingsPage() {
  const rg = useMyResponsibleGaming();

  if (rg.isLoading) {
    return (
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-32 w-full rounded-[var(--radius-xl)] bg-[var(--color-bg-subtle)]" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 w-full rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-64 w-full rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-text)]">
          <Shield className="size-3" />
          Tu cuenta
        </span>
        <h1 className="font-display text-[34px] leading-none">Mi cuenta</h1>
      </header>

      <ProfileHero />

      {rg.data?.exclusion && <ExclusionBanner exclusion={rg.data.exclusion} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Columna izquierda */}
        <div className="flex flex-col gap-4">
          <DatosPersonales />
          <NotificacionesSection />
        </div>
        {/* Columna derecha */}
        <div className="flex flex-col gap-4">
          <SeguridadSection />
          <SessionsSection />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Perfil + datos + seguridad
// ──────────────────────────────────────────────────────────────────────

function ProfileHero() {
  const { user } = useAuth();
  const wallet = useMyWallet();
  const vip = useVipTier();

  const name = user?.displayName || user?.username || 'Jugador';
  const initials = initialsFrom(name);
  const TierIcon = vip.tier.icon;
  const saldo =
    wallet.data?.balance != null
      ? `$ ${arsFmt.format(Number(wallet.data.balance))}`
      : '—';
  const twoFa = user?.twoFaEnabled;

  return (
    <section
      className="flex flex-col items-center gap-5 rounded-[var(--radius-xl)] border border-[var(--color-border)] p-6 sm:flex-row"
      style={{
        backgroundImage:
          'radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, var(--color-purple) 18%, transparent) 0%, transparent 55%), var(--color-bg-elevated)',
      }}
    >
      {/* Avatar */}
      <div
        className="grid size-20 shrink-0 place-items-center rounded-[var(--radius-lg)] font-display text-[28px] text-white"
        style={{
          background: 'linear-gradient(135deg, #7b2ff7, #ff3ec9)',
          boxShadow: '0 0 28px -6px rgba(123,47,247,.6)',
        }}
      >
        {initials}
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col items-center gap-2 text-center sm:items-start sm:text-left">
        <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          <h2 className="font-display text-[24px] leading-none">{name}</h2>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#1a1206]"
            style={{ background: vip.tier.gradient }}
          >
            <TierIcon className="size-3" />
            VIP {vip.tier.label}
          </span>
        </div>
        <span className="text-[12px] text-[var(--color-fg-muted)]">
          @{user?.username ?? '—'}
          {user?.email ? ` · ${user.email}` : ''}
        </span>
        <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
          <HeroStat label="Saldo" value={saldo} color="var(--color-fg)" />
          <HeroStat
            label="Nivel VIP"
            value={vip.tier.label}
            color="var(--color-gold)"
          />
          <HeroStat
            label="Volumen apostado"
            value={`${Number(vip.volume).toLocaleString('es-AR')} fichas`}
            color="var(--color-accent-text)"
          />
        </div>
      </div>

      {/* Estado */}
      <span
        className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em]"
        style={{
          color: 'var(--color-success)',
          background: 'color-mix(in srgb, var(--color-success) 14%, transparent)',
        }}
      >
        <Check className="size-3" />
        {twoFa ? 'Verificado' : 'Cuenta activa'}
      </span>
    </section>
  );
}

function HeroStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-medium uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span className="text-[15px] font-semibold tabular-nums" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function DatosPersonales() {
  const { user } = useAuth();
  const rows: { label: string; value: string; icon: typeof User }[] = [
    { label: 'Usuario', value: `@${user?.username ?? '—'}`, icon: AtSign },
    { label: 'Nombre', value: user?.displayName || '—', icon: User },
    { label: 'Email', value: user?.email || '—', icon: Mail },
  ];
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
      <h3 className="mb-4 font-display text-[18px]">Datos personales</h3>
      <ul className="flex flex-col divide-y divide-[var(--color-border)]">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <li
              key={r.label}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <span className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
                <Icon className="size-3.5 text-[var(--color-fg-subtle)]" />
                {r.label}
              </span>
              <span className="truncate text-[13px] text-[var(--color-fg)]">
                {r.value}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
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

// ──────────────────────────────────────────────────────────────────────
// Notificaciones push (este dispositivo)
// ──────────────────────────────────────────────────────────────────────

function NotificacionesSection() {
  return (
    <section className="flex flex-col gap-4 p-5 card-premium rounded-[var(--radius-lg)]">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
          Notificaciones
        </span>
        <h2 className="font-display text-xl tracking-tight text-[var(--color-fg)]">
          Este dispositivo
        </h2>
      </div>
      <PushNotificationsToggle panel="player" />
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Exclusion banner (si ya tiene una activa)
// ──────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

// Suppress unused warnings for icons that may be reserved for future use.
void Calendar;
void RefreshCw;
