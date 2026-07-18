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
  Gauge,
  Info,
  Lock,
  Plus,
  ShieldAlert,
  Sprout,
  UserCog,
  Vault,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { AssignEmployeeCapModal } from '@/components/admin/assign-employee-cap-modal';
import { CapitalNeededWidget } from '@/components/admin/capital-needed-widget';
import { EditBettingCapsModal } from '@/components/admin/edit-betting-caps-modal';
import { EditCorrectionCapModal } from '@/components/admin/edit-correction-cap-modal';
import { InjectBudgetModal } from '@/components/admin/inject-budget-modal';
import { StockAlertBanner } from '@/components/admin/stock-alert-banner';
import { isApiError } from '@/lib/api-client';
import { isIndependentBranch, useAuth } from '@/lib/auth-context';
import {
  useBettingCaps,
  useCapitalInjections,
  useHouseState,
  useMintBudget,
} from '@/lib/hooks/use-house';
import {
  useEmployeesWithCap,
  type EmployeeWithCap,
} from '@/lib/hooks/use-correction';

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
  { icon: Dices, label: 'Juego con la Casa (bet → Casa, win ← Casa) + topes de apuesta', phase: 'B-build-4' },
  { icon: Coins, label: 'Premiaciones desde la Casa (comisiones, bonos, promos)', phase: 'B-build-5' },
  { icon: ShieldAlert, label: 'Invariante de respaldo (fichas ≤ plata real)', phase: 'B-build-6' },
];

export default function TesoreriaPage() {
  const house = useHouseState();
  const injections = useCapitalInjections();
  const { user } = useAuth();
  // Fase 4 · bonus: si el user es socio indep, apuntamos los widgets a su
  // wallet propia (`?operatorUserId=<self>`). El admin (default) apunta a
  // la Casa (operatorUserId=null).
  const indepMode = isIndependentBranch(user);
  const operatorUserId = indepMode ? (user?.id ?? null) : null;
  const [budgetOpen, setBudgetOpen] = useState(false);
  const mintBudget = useMintBudget();
  const canEditCap =
    user?.effectivePermissions === undefined ||
    user.effectivePermissions.includes('users.edit');
  const employees = useEmployeesWithCap(canEditCap);
  const [capEditing, setCapEditing] = useState<EmployeeWithCap | null>(null);
  const [assignCapOpen, setAssignCapOpen] = useState(false);
  const notProvisioned =
    house.isError && isApiError(house.error) && house.error.status === 404;
  // Gate de UX del botón; el backend igual exige house.inject_capital.
  const canInject =
    user?.effectivePermissions === undefined ||
    user.effectivePermissions.includes('house.inject_capital');
  const caps = useBettingCaps();
  const [capsOpen, setCapsOpen] = useState(false);
  const canEditCaps =
    user?.effectivePermissions === undefined ||
    user.effectivePermissions.includes('tenant.settings.edit');

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1100px] mx-auto">
      {/* Header */}
      <header className="flex items-start justify-between gap-6 pb-2">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Vault className="size-3" />
            Núcleo · Tesorería
          </span>
          <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
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
        </div>
        {canInject && !notProvisioned && (
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={() => setBudgetOpen(true)}
              title="Crear fichas (minteo). Capado por el tope mensual salvo que marques Fondeo."
            >
              <Plus className="size-3.5" />
              Fondear presupuesto
            </Button>
          </div>
        )}
      </header>

      {/* Banner de salud del bankroll. Bonus (indep): apunta a su wallet
       * propia y oculta el CTA de inyectar (no aplica a socios indep). */}
      {!notProvisioned && (
        <StockAlertBanner
          operatorUserId={operatorUserId}
          showInjectCta={!indepMode && canInject}
        />
      )}

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
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto border-l-2 border-l-[var(--color-accent)] p-5 flex flex-col gap-1">
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
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto p-5 flex flex-col gap-1">
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
            es <strong>fondear presupuesto</strong>, capado por el tope mensual
            de minteo.
          </span>
        </div>
      </div>

      {/* Proyección de capital necesario. Mismo `operatorUserId` que el
       * banner de arriba — indep ve la salud de SU sub-red. */}
      {!notProvisioned && (
        <CapitalNeededWidget
          operatorUserId={operatorUserId}
          defaultDays={30}
          title={indepMode ? 'Drenaje de tu sub-red' : 'Capital necesario'}
        />
      )}

      {/* Presupuesto mensual de minteo — tope de creación de fichas del mes. */}
      {!notProvisioned && (
        <section className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
            <Coins className="size-3" />
            Presupuesto mensual de minteo
          </span>
          {mintBudget.isLoading ? (
            <Skeleton className="h-24" />
          ) : mintBudget.isError || !mintBudget.data ? (
            <EmptyState
              hint="data"
              label="No se pudo cargar el presupuesto mensual de minteo."
            />
          ) : Number(mintBudget.data.monthlyBudget) >= 1e11 ? (
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto border-l-2 border-l-[var(--color-accent)] p-5 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] flex items-center gap-1.5">
                <Coins className="size-3.5" />
                Tope del mes
              </span>
              <span className="text-[1.25rem] leading-tight text-[var(--color-fg)]">
                Sin tope configurado
              </span>
              <span className="text-[11px] text-[var(--color-fg-subtle)] mt-1">
                Configuralo en Ajustes ({' '}
                <span className="font-mono">treasury.monthly_mint_budget</span>).
                Usado este mes:{' '}
                <span className="font-mono">
                  {fmt(mintBudget.data.mintedThisMonth)}
                </span>
                .
              </span>
            </div>
          ) : (
            (() => {
              const monthly = Number(mintBudget.data.monthlyBudget);
              const minted = Number(mintBudget.data.mintedThisMonth);
              const pct =
                monthly > 0
                  ? Math.min(100, Math.max(0, (minted / monthly) * 100))
                  : 0;
              const nearFull = pct >= 90;
              return (
                <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto border-l-2 border-l-[var(--color-accent)] p-5 flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                        Tope del mes
                      </span>
                      <span className="text-[1.4rem] font-mono num leading-none text-[var(--color-fg)]">
                        {fmt(mintBudget.data.monthlyBudget)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                        Minteado este mes
                      </span>
                      <span className="text-[1.4rem] font-mono num leading-none text-[var(--color-fg-muted)]">
                        {fmt(mintBudget.data.mintedThisMonth)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                        Disponible
                      </span>
                      <span
                        className={`text-[1.4rem] font-mono num leading-none ${
                          nearFull
                            ? 'text-[var(--color-warning)]'
                            : 'text-[var(--color-success)]'
                        }`}
                      >
                        {fmt(mintBudget.data.available)}
                      </span>
                    </div>
                  </div>
                  {/* Barra de progreso usado/tope */}
                  <div className="flex flex-col gap-1.5">
                    <div className="h-2 w-full bg-[var(--color-bg)] border border-[var(--color-border)] overflow-hidden">
                      <div
                        className={`h-full transition-[width] ${
                          nearFull
                            ? 'bg-[var(--color-warning)]'
                            : 'bg-[var(--color-accent)]'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-[var(--color-fg-subtle)]">
                      {pct.toFixed(1)}% del tope usado este mes. Superarlo exige
                      marcar <strong>Fondeo</strong> al minter.
                    </span>
                  </div>
                </div>
              );
            })()
          )}
        </section>
      )}

      {/* Aportes de capital (B-build-3) */}
      <section className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
          <Sprout className="size-3" />
          Fondeos de la Casa
        </span>
        {injections.isLoading ? (
          <Skeleton className="h-24" />
        ) : injections.isError || !injections.data ? (
          <EmptyState hint="data" label="No se pudo cargar el historial de fondeos." />
        ) : injections.data.injections.length === 0 ? (
          <EmptyState
            hint="data"
            label="Todavía no hay fondeos. Usá “Fondear presupuesto” para arrancar."
          />
        ) : (
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Fecha</TH>
                  <TH>Tipo</TH>
                  <TH className="text-right">Monto</TH>
                  <TH>Motivo</TH>
                  <TH>Notas</TH>
                </TR>
              </THead>
              <TBody>
                {injections.data.injections.map((inj) => (
                  <TR key={inj.id}>
                    <TD className="num text-[11px] text-[var(--color-fg-muted)]">
                      {new Date(inj.createdAt).toLocaleString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TD>
                    <TD>
                      <Badge variant={inj.type === 'capital' ? 'success' : 'info'}>
                        {inj.type === 'capital' ? 'Capital' : 'Presupuesto'}
                      </Badge>
                    </TD>
                    <TD className="text-right num font-mono text-[var(--color-success)]">
                      +{fmt(inj.amount)}
                    </TD>
                    <TD className="text-[12px] text-[var(--color-fg)]">
                      {inj.reason}
                    </TD>
                    <TD className="text-[12px] text-[var(--color-fg-muted)]">
                      {inj.notes ?? '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>

      {/* Cupos de empleados para cargas por corrección (docs/19) */}
      {canEditCap && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
              <UserCog className="size-3" />
              Cupos de empleados
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAssignCapOpen(true)}
            >
              <Plus className="size-3" />
              Asignar cupo a un empleado
            </Button>
          </div>
          <p className="text-[12px] text-[var(--color-fg-muted)]">
            Empleados con permiso para hacer{' '}
            <strong>cargas por corrección / bonificación / reintegro</strong> a
            clientes. El cupo es un techo mensual: se resetea el 1° de cada mes.
          </p>
          {employees.isLoading ? (
            <Skeleton className="h-24" />
          ) : employees.isError || !employees.data ? (
            <EmptyState hint="data" label="No se pudo cargar la lista de empleados." />
          ) : employees.data.employees.length === 0 ? (
            <EmptyState
              hint="data"
              label="Todavía no hay empleados con cupo configurado. Editá el cupo desde el detalle de un usuario o vía la API."
            />
          ) : (
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Empleado</TH>
                    <TH className="text-right">Cupo / mes</TH>
                    <TH className="text-right">Usado</TH>
                    <TH className="text-right">Restante</TH>
                    <TH></TH>
                  </TR>
                </THead>
                <TBody>
                  {employees.data.employees.map((emp) => (
                    <TR key={emp.userId}>
                      <TD className="text-[12px] text-[var(--color-fg)]">
                        <div className="flex flex-col leading-tight">
                          <span>{emp.displayName}</span>
                          <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
                            {emp.username}
                          </span>
                        </div>
                      </TD>
                      <TD className="text-right num font-mono text-[var(--color-fg)]">
                        {fmt(emp.cap)}
                      </TD>
                      <TD className="text-right num font-mono text-[var(--color-fg-muted)]">
                        {fmt(emp.used)}
                      </TD>
                      <TD className="text-right num font-mono text-[var(--color-success)]">
                        {fmt(emp.remaining)}
                      </TD>
                      <TD className="text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setCapEditing(emp)}
                        >
                          Editar
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {/* Topes de apuesta (B-build-4b) */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
            <Gauge className="size-3" />
            Topes de apuesta (exposición)
          </span>
          {canEditCaps && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCapsOpen(true)}
            >
              Editar topes
            </Button>
          )}
        </div>
        {caps.isLoading ? (
          <Skeleton className="h-20" />
        ) : caps.isError || !caps.data ? (
          <EmptyState hint="data" label="No se pudieron cargar los topes." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto p-3 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
                Tope por jugador / mes
              </span>
              <span className="text-[1.1rem] font-mono num leading-tight text-[var(--color-fg)]">
                {caps.data.caps.playerMonthly === 0 ? (
                  <span className="text-[13px] text-[var(--color-fg-subtle)]">
                    sin tope
                  </span>
                ) : (
                  fmt(String(caps.data.caps.playerMonthly))
                )}
              </span>
            </div>
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto p-3 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
                Tope global / mes
              </span>
              <span className="text-[1.1rem] font-mono num leading-tight text-[var(--color-fg)]">
                {caps.data.caps.globalMonthly === 0 ? (
                  <span className="text-[13px] text-[var(--color-fg-subtle)]">
                    sin tope
                  </span>
                ) : (
                  fmt(String(caps.data.caps.globalMonthly))
                )}
              </span>
            </div>
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto border-l-2 border-l-[var(--color-accent)] p-3 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
                Apostado este mes (global)
              </span>
              <span className="text-[1.1rem] font-mono num leading-tight text-[var(--color-accent-text)]">
                {fmt(caps.data.turnover.global)}
              </span>
            </div>
          </div>
        )}
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          Limitan el volumen apostado por mes (turnover). Al superarse, las
          apuestas se <strong>bloquean</strong> — protege contra que un bug o
          fraude te genere deuda con el proveedor externo.
        </p>
      </section>

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

      <InjectBudgetModal open={budgetOpen} onOpenChange={setBudgetOpen} />
      {capEditing && (
        <EditCorrectionCapModal
          open={!!capEditing}
          onOpenChange={(o) => !o && setCapEditing(null)}
          userId={capEditing.userId}
          username={capEditing.username}
          currentCap={capEditing.cap}
        />
      )}

      <AssignEmployeeCapModal
        open={assignCapOpen}
        onOpenChange={setAssignCapOpen}
      />
      <EditBettingCapsModal
        open={capsOpen}
        onOpenChange={setCapsOpen}
        current={caps.data}
      />
    </div>
  );
}
