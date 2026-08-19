'use client';

/**
 * Contenedor de /play/account (docs/21-plan-perfil-wallet.md).
 *
 * Página única "Mi cuenta" con 4 tabs: Perfil · Mi dinero · Movimientos ·
 * Seguridad. El tab activo vive en la URL (?tab=) para que los redirects de
 * /play/wallet y /play/settings aterricen en el tab correcto. El tab por
 * default (sin query) es "perfil".
 */

import { Coins, History, Shield, UserRound } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { AccountTab } from './account-tab-meta';
import { DineroTab } from './dinero-tab';
import { MovimientosTab } from './movimientos-tab';
import { PerfilTab } from './perfil-tab';
import { SeguridadTab } from './seguridad-tab';

const TABS: { id: AccountTab; label: string; icon: typeof UserRound }[] = [
  { id: 'perfil', label: 'Perfil', icon: UserRound },
  { id: 'dinero', label: 'Mi dinero', icon: Coins },
  { id: 'movimientos', label: 'Movimientos', icon: History },
  { id: 'seguridad', label: 'Seguridad', icon: Shield },
];

export { isAccountTab } from './account-tab-meta';
export type { AccountTab } from './account-tab-meta';

export function AccountTabs({ initialTab }: { initialTab: AccountTab }) {
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const router = useRouter();
  const pathname = usePathname();

  const selectTab = (next: AccountTab) => {
    setTab(next);
    const params = new URLSearchParams();
    if (next !== 'perfil') params.set('tab', next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-text)]">
          <UserRound className="size-3" />
          Tu cuenta
        </span>
        <h1 className="font-display text-[34px] leading-none">Mi cuenta</h1>
      </header>

      {/* Tabs */}
      <div
        className="flex flex-wrap items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1"
        role="tablist"
        aria-label="Secciones de tu cuenta"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(t.id)}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors',
                active
                  ? 'text-[var(--color-accent-fg)]'
                  : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
              )}
              style={active ? { background: 'var(--gradient-accent)' } : undefined}
            >
              <Icon className="size-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div key={tab} className="animate-page-enter">
        {tab === 'perfil' && <PerfilTab />}
        {tab === 'dinero' && <DineroTab />}
        {tab === 'movimientos' && <MovimientosTab />}
        {tab === 'seguridad' && <SeguridadTab />}
      </div>
    </div>
  );
}
