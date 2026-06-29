/**
 * /tesoreria — La Casa / tesorería (Blindaje del núcleo económico, Parte B).
 *
 * Una sección MÁS del panel de admin (no es una app aparte ni un login aparte):
 * el admin administra desde acá la cuenta "Casa", que es la única fuente de
 * fichas y la contraparte de todo (depósitos, juego, premios).
 *
 * B-build-1b: muestra el estado de la Casa (balance + bloqueado) y explica qué
 * es. Las piezas que faltan (aporte de capital, GGR, exposición, respaldo) se
 * van sumando a esta pantalla en B-build-2..6.
 *
 * Permiso: house.view. Solo admin_tenant.
 */

'use client';

import {
  Banknote,
  Coins,
  Dices,
  Info,
  Lock,
  ShieldAlert,
  Sprout,
  Vault,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import { useHouseState } from '@/lib/hooks/use-house';

function fmt(x: string | null | undefined): string {
  if (x === null || x === undefined) return '—';
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const ROADMAP: { icon: typeof Sprout; label: string; phase: string }[] = [
  { icon: Sprout, label: 'Aporte de capital (atado a respaldo real)', phase: 'B-build-3' },
  { icon: Dices, label: 'Juego con la Casa (bet → Casa, win ← Casa) + topes de apuesta', phase: 'B-build-4' },
  { icon: Coins, label: 'Premiaciones desde la Casa (comisiones, bonos, promos)', phase: 'B-build-5' },
  { icon: ShieldAlert, label: 'Invariante de respaldo (fichas ≤ plata real)', phase: 'B-build-6' },
];

export default function TesoreriaPage() {
  const house = useHouseState();
  const notProvisioned =
    house.isError && isApiError(house.error) && house.error.status === 404;

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1100px] mx-auto">
      {/* Header */}
      <header className="flex flex-col gap-2 pb-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <Vault className="size-3" />
          Núcleo · Tesorería
        </span>
        <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
          Tesorería · la Casa
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1 max-w-2xl">
          La <strong>Casa</strong> es la caja del casino: la única cuenta que
          crea fichas y la contraparte de todo (depósitos, apuestas, premios).
          Su balance refleja la <strong>ganancia real</strong> del negocio.{' '}
          <span className="text-[var(--color-fg-subtle)]">
            Es una cuenta de sistema que vos administrás desde acá.
          </span>
        </p>
      </header>

      {/* Estado de la Casa */}
      {house.isLoading ? (
        <Skeleton className="h-28" />
      ) : notProvisioned ? (
        <EmptyState
          hint="data"
          label="La Casa todavía no está provisionada en este tenant. Se crea al migrar/seedear."
        />
      ) : house.isError || !house.data ? (
        <EmptyState
          hint="data"
          label="No se pudo cargar el estado de la Casa. Verificá la conexión."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] border-l-2 border-l-[var(--color-accent)] p-5 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] flex items-center gap-1.5">
              <Banknote className="size-3.5" />
              Saldo de la Casa
            </span>
            <span className="text-[2rem] font-mono num leading-none text-[var(--color-fg)]">
              {fmt(house.data.balance)}
            </span>
            <span className="text-[11px] text-[var(--color-fg-subtle)] mt-1">
              Fichas disponibles para pagar premios / comisiones / bonos.
            </span>
          </div>
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-5 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] flex items-center gap-1.5">
              <Lock className="size-3.5" />
              Bloqueado
            </span>
            <span className="text-[2rem] font-mono num leading-none text-[var(--color-fg-muted)]">
              {fmt(house.data.lockedBalance)}
            </span>
            <span className="text-[11px] text-[var(--color-fg-subtle)] mt-1 font-mono">
              {house.data.username}
            </span>
          </div>
        </div>
      )}

      {/* Qué es la Casa */}
      <div className="flex items-start gap-3 px-4 py-3 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
        <Info className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
        <div className="flex flex-col gap-1 text-[12px] text-[var(--color-fg)] leading-snug">
          <span>
            <strong>Toda ficha que circula salió de la Casa.</strong> Cuando un
            jugador deposita, la Casa le emite fichas respaldadas por la
            transferencia bancaria. Cuando apuesta, las fichas van a la Casa;
            cuando gana, salen de la Casa. La única forma de crear fichas nuevas
            es que vos le aportes capital (con la plata real que las respalda).
          </span>
        </div>
      </div>

      {/* Roadmap del panel (honesto: qué falta construir) */}
      <section className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
          Próximamente en esta pantalla
        </span>
        <div className="flex flex-col divide-y divide-[var(--color-border)] border border-[var(--color-border)]">
          {ROADMAP.map((r) => {
            const Icon = r.icon;
            return (
              <div
                key={r.phase}
                className="flex items-center gap-3 px-4 py-2.5 bg-[var(--color-bg-elevated)]"
              >
                <Icon className="size-4 text-[var(--color-fg-subtle)] shrink-0" />
                <span className="flex-1 text-[12px] text-[var(--color-fg-muted)]">
                  {r.label}
                </span>
                <Badge variant="neutral">{r.phase}</Badge>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
