/**
 * /dashboard — pantalla inicial del operador.
 *
 * Composición (server-rendered + client islands):
 *   1. Hero strip — saludo + acción primaria + meta del tenant.
 *   2. Grid de KPIs (4 tiles).
 *   3. Activity log (placeholder rows con shimmer state).
 *   4. Quick actions panel.
 *
 * Data: hoy todo placeholder. Próximo sprint conecta endpoints reales
 * (stats fraud, count users, wallet circulating supply, etc.).
 */

'use client';

import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Coins,
  Gauge,
  ShieldCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { StatTile } from '@/components/ui/stat-tile';
import { useAuth } from '@/lib/auth-context';

export default function DashboardPage() {
  const { user } = useAuth();
  const [time, setTime] = useState<string>('');

  // Hora "live" en el header — refresh cada segundo.
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-8 max-w-[1600px] mx-auto">
      {/* ── Hero strip ──────────────────────────────────────── */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-2">
        <div className="flex flex-col gap-3 animate-fade-up">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <span className="font-mono text-[var(--color-accent)]">{time}</span>
            <span className="text-[var(--color-border-strong)]">·</span>
            <span>Sesión activa</span>
          </span>
          <h1 className="font-display text-[2.5rem] lg:text-[3.25rem] leading-none tracking-tight">
            Buen día,{' '}
            <span className="text-[var(--color-accent)]">
              {firstName(user?.displayName ?? user?.username ?? 'Operador')}
            </span>
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] max-w-xl mt-1">
            Estás operando el tenant{' '}
            <span className="font-mono text-[var(--color-fg)]">jest.localhost</span>.
            Toda mutación queda registrada en el audit log.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="md" asChild>
            <Link href="/audit">
              <Activity className="size-3.5" />
              Ver actividad
            </Link>
          </Button>
          <Button variant="primary" size="md" asChild>
            <Link href="/users">
              Gestionar usuarios
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </section>

      {/* ── KPIs ────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--color-border)]">
        <StatTile
          label="Usuarios activos"
          value="—"
          unit="·"
          hint="últimos 30d"
        />
        <StatTile
          label="Fichas en circulación"
          value="—"
          unit="chips"
          hint="net"
        />
        <StatTile
          label="Depósitos pendientes"
          value="—"
          unit="ops"
          variant="accent"
          hint="hoy"
        />
        <StatTile
          label="Bonos activos"
          value="—"
          hint="cliente"
        />
      </section>

      {/* ── Quick actions + Activity feed ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-px bg-[var(--color-border)]">
        {/* Activity */}
        <div className="bg-[var(--color-bg-elevated)] p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="size-3.5 text-[var(--color-accent)]" />
              <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
                Actividad reciente
              </span>
            </div>
            <Link
              href="/audit"
              className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors flex items-center gap-1"
            >
              Ver todo
              <ArrowUpRight className="size-3" />
            </Link>
          </div>

          {/* Empty state estilizado — terminal/ascii vibe */}
          <div className="border border-dashed border-[var(--color-border-strong)] p-8 flex flex-col items-center justify-center gap-3 min-h-[260px]">
            <div className="font-mono text-[var(--color-fg-subtle)] text-xs whitespace-pre-line text-center leading-relaxed">
              {`> waiting for events ...
> stream: audit_log:tenant:jest
> ────────────────────────────`}
            </div>
            <span className="text-[11px] text-[var(--color-fg-subtle)] uppercase tracking-[0.1em] mt-2">
              Sin actividad para mostrar
            </span>
          </div>
        </div>

        {/* Quick actions */}
        <div className="bg-[var(--color-bg-elevated)] p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Gauge className="size-3.5 text-[var(--color-accent)]" />
            <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
              Atajos
            </span>
          </div>

          <div className="flex flex-col gap-px bg-[var(--color-border)]">
            <QuickAction
              href="/users"
              icon={Users}
              title="Crear usuario"
              hint="Nuevo cajero, distribuidor o jugador"
            />
            <QuickAction
              href="/wallet"
              icon={Coins}
              title="Mint de fichas"
              hint="Crear nuevas fichas al pool del tenant"
            />
            <QuickAction
              href="/fraud"
              icon={ShieldCheck}
              title="Revisar antifraude"
              hint="Links suspected pendientes"
            />
          </div>
        </div>
      </div>

      {/* ── Footer meta ─────────────────────────────────────── */}
      <footer className="flex items-center justify-between text-[10px] text-[var(--color-fg-subtle)] uppercase tracking-[0.12em] pt-6 border-t border-[var(--color-border)]">
        <span className="font-mono normal-case">
          tenant://jest · build {new Date().getFullYear()}.{(new Date().getMonth() + 1).toString().padStart(2, '0')}
        </span>
        <span>El sistema graba todas las acciones</span>
      </footer>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  title,
  hint,
}: {
  href: string;
  icon: typeof Activity;
  title: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="group bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] p-3 flex items-center gap-3 transition-colors duration-150 border-l-2 border-l-transparent hover:border-l-[var(--color-accent)]"
    >
      <div className="size-8 shrink-0 border border-[var(--color-border)] bg-[var(--color-bg-subtle)] flex items-center justify-center group-hover:border-[var(--color-accent-border)] transition-colors">
        <Icon className="size-3.5 text-[var(--color-fg-muted)] group-hover:text-[var(--color-accent)] transition-colors" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[var(--color-fg)] tracking-tight">{title}</div>
        <div className="text-[11px] text-[var(--color-fg-subtle)] truncate">{hint}</div>
      </div>
      <ArrowRight className="size-3.5 text-[var(--color-fg-subtle)] group-hover:text-[var(--color-fg-muted)] group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}

function firstName(full: string): string {
  return full.split(/\s+/)[0] || full;
}
