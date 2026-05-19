/**
 * /play — dashboard del jugador.
 *
 * Composición:
 *   - Hero balance: chips actuales con tipografía display grande + glow
 *     accent + locked balance breakdown (si hay holds activos).
 *   - Quick actions: 4 cards grandes — Wallet · Bonos · (futuro: Depositar
 *     · Juegos). Hoy 2 reales + 2 placeholder.
 *   - Promo strip (futuro): banner horizontal con la promo destacada del
 *     tenant (daily wheel / streak / lottery).
 *   - Recent activity: últimas 5 wallet transactions del jugador.
 *
 * MVP: solo lo que el backend ya soporta sin features extra (login, wallet,
 * bonos, tx). Depósitos/retiros/promos llegan en sprints incrementales.
 */

'use client';

import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpToLine,
  Coins,
  Gift,
  Wallet as WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useMyBonuses } from '@/lib/hooks/use-bonuses';
import { useMyTransactions, useMyWallet } from '@/lib/hooks/use-wallet';
import { cn } from '@/lib/cn';

export default function PlayDashboardPage() {
  const { user } = useAuth();
  const wallet = useMyWallet();
  const txs = useMyTransactions(5, 0);
  // Mis bonos activos — endpoint user-facing /tenant/bonuses/me (no
  // requiere bonuses.view_any).
  const myBonuses = useMyBonuses({
    statuses: ['active', 'pending'],
    limit: 5,
  });

  const balance = wallet.data?.balance;
  const lockedBalance = wallet.data?.lockedBalance;
  const hasLocked = lockedBalance && Number(lockedBalance) > 0;

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10 flex flex-col gap-10">
      {/* Greeting */}
      <header className="flex flex-col gap-2 animate-fade-up">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
          Bienvenido de vuelta
        </span>
        <h1 className="font-display text-[2.5rem] sm:text-[3rem] leading-none tracking-tight">
          Hola, {user?.displayName?.split(' ')[0] ?? user?.username ?? 'jugador'}
        </h1>
      </header>

      {/* Hero balance */}
      <section className="relative animate-fade-up">
        <div
          aria-hidden
          className="absolute -inset-x-8 -top-8 h-64 opacity-30 blur-3xl pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center, var(--color-accent-glow) 0%, transparent 65%)',
          }}
        />
        <div className="relative border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-8 sm:p-10 flex flex-col gap-6">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
            <Coins className="size-3 text-[var(--color-accent-text)]" />
            Tu saldo
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="font-display text-[4rem] sm:text-[5rem] leading-none tracking-tight tabular-nums text-[var(--color-fg)]">
              {wallet.isLoading
                ? '—'
                : balance
                  ? Number(balance).toLocaleString('es-AR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : '0,00'}
            </span>
            <span className="font-mono text-sm uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
              CHIPS
            </span>
          </div>
          {hasLocked && (
            <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
              <span className="font-mono tabular-nums">
                {Number(lockedBalance).toLocaleString('es-AR')}
              </span>
              <span className="uppercase tracking-[0.1em] text-[10px]">
                en hold (retiros pendientes)
              </span>
            </div>
          )}
          <div className="flex items-center gap-3 pt-2">
            <Link href="/play/wallet" className="inline-block">
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 h-10 bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-hover)] transition-colors text-[13px] font-medium tracking-tight"
              >
                Ver wallet
                <ArrowRight className="size-3.5" />
              </button>
            </Link>
            <Link href="/play/bonuses" className="inline-block">
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 h-10 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] text-[var(--color-fg)] hover:border-[var(--color-border-strong)] transition-colors text-[13px] font-medium tracking-tight"
              >
                Mis bonos
                <Gift className="size-3.5" />
              </button>
            </Link>
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <section className="flex flex-col gap-3 animate-fade-up">
        <h2 className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
          Accesos rápidos
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--color-border)]">
          <QuickAction
            href="/play/deposits"
            icon={ArrowDownToLine}
            label="Depositar"
            hint="Solicitar carga"
          />
          <QuickAction
            href="/play/withdrawals"
            icon={ArrowUpToLine}
            label="Retirar"
            hint="Solicitar cobro"
          />
          <QuickAction
            href="/play/wallet"
            icon={WalletIcon}
            label="Wallet"
            hint="Saldo + historial"
          />
          <QuickAction
            href="/play/bonuses"
            icon={Gift}
            label="Bonos"
            hint={
              myBonuses.data?.total
                ? `${myBonuses.data.total} activo${myBonuses.data.total === 1 ? '' : 's'}`
                : 'Ver disponibles'
            }
          />
        </div>
      </section>

      {/* Recent activity */}
      <section className="flex flex-col gap-3 animate-fade-up">
        <div className="flex items-end justify-between">
          <h2 className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
            Actividad reciente
          </h2>
          <Link
            href="/play/wallet"
            className="text-[11px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] uppercase tracking-[0.08em] transition-colors"
          >
            Ver todo →
          </Link>
        </div>
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
          {txs.isLoading ? (
            <div className="px-4 py-3 text-[12px] text-[var(--color-fg-subtle)] italic">
              Cargando…
            </div>
          ) : !txs.data || txs.data.data.length === 0 ? (
            <div className="px-4 py-3 text-[12px] text-[var(--color-fg-subtle)] italic">
              Sin movimientos todavía.
            </div>
          ) : (
            txs.data.data.map((tx) => {
              const isCredit = isCreditType(tx.type);
              const sign = isCredit ? '+' : '−';
              return (
                <div
                  key={tx.id}
                  className="grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-2.5 items-center"
                >
                  <span
                    className={cn(
                      'text-[10px] uppercase tracking-[0.1em] font-mono w-24 truncate',
                      isCredit
                        ? 'text-[var(--color-success)]'
                        : 'text-[var(--color-fg-muted)]',
                    )}
                  >
                    {tx.type}
                  </span>
                  <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono truncate">
                    {tx.reason ?? '—'}
                  </span>
                  <span
                    className={cn(
                      'font-mono tabular-nums text-[13px]',
                      isCredit
                        ? 'text-[var(--color-success)]'
                        : 'text-[var(--color-fg)]',
                    )}
                  >
                    {sign}
                    {Number(tx.amount).toLocaleString('es-AR')}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function QuickAction({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string;
  icon: typeof WalletIcon;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="group bg-[var(--color-bg-elevated)] p-5 flex flex-col gap-3 hover:bg-[var(--color-bg-subtle)] transition-colors border-l-2 border-l-transparent hover:border-l-[var(--color-accent)]"
    >
      <Icon className="size-5 text-[var(--color-fg-subtle)] group-hover:text-[var(--color-accent-text)] transition-colors" />
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] text-[var(--color-fg)] font-medium tracking-tight">
          {label}
        </span>
        <span className="text-[11px] text-[var(--color-fg-subtle)]">{hint}</span>
      </div>
    </Link>
  );
}

/**
 * Determina si un wallet_tx type es crédito (suma chips) o débito.
 * Lista hardcodeada — espeja el enum del backend (wallet-transactions.ts).
 */
function isCreditType(type: string): boolean {
  return [
    'mint',
    'load',
    'transfer_in',
    'win',
    'deposit',
    'adjustment_credit',
    'bonus_grant',
    'bonus_clear',
    'bonus_funding_revert',
    'jackpot_win',
    'promo_reward',
    'league_reward',
    'commission_payout',
    'fund_release',
  ].includes(type);
}
