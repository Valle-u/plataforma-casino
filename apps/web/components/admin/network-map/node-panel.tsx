/**
 * NodePanel — panel lateral del mapa de red (Fase 3). Se abre al clickear un
 * nodo de usuario. Muestra el detalle + el menú de acciones reusado de
 * Usuarios (UserActionsCell, variante sheet) + reasignar de padre (buscador +
 * confirmación, reusa el endpoint con validaciones de ciclo/permiso).
 */

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, GitFork, X } from 'lucide-react';
import { toast } from 'sonner';
import { isApiError } from '@/lib/api-client';
import {
  useSetParent,
  useUsersList,
  type TenantUserRow,
} from '@/lib/hooks/use-users';
import type { NetworkNode } from '@/lib/hooks/use-network-tree';
import { roleStyle } from './roles';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { UserSelect } from '@/components/ui/user-select';
import { UserActionsCell } from '@/components/admin/user-actions-cell';
import { cn } from '@/lib/cn';

const STATUS_LABEL: Record<string, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
  suspended: 'Suspendido',
  banned: 'Bloqueado',
  pending: 'Pendiente',
};

export function NodePanel({
  node,
  onClose,
  onChanged,
}: {
  node: NetworkNode | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  // Traemos el TenantUserRow real (balance, email, etc.) para que el menú de
  // acciones funcione idéntico a la sección Usuarios.
  const list = useUsersList({
    search: node?.username ?? '',
    includeSelf: true,
    limit: 25,
  });
  const row: TenantUserRow | null = useMemo(
    () => list.data?.data.find((u) => u.id === node?.id) ?? null,
    [list.data, node?.id],
  );

  const setParent = useSetParent(node?.id ?? null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [newParent, setNewParent] = useState<TenantUserRow | null>(null);

  const role = node ? roleStyle(node.primaryRole) : null;

  const handleReassign = async () => {
    if (!newParent) return;
    try {
      await setParent.mutateAsync({
        parentUserId: newParent.id,
        relationType: 'asignado_manual',
      });
      toast.success('Reasignado', {
        description: `Ahora cuelga de ${newParent.displayName || newParent.username}.`,
      });
      setReassignOpen(false);
      setNewParent(null);
      onChanged();
    } catch (err) {
      const msg = !isApiError(err)
        ? 'Error de conexión.'
        : err.status === 409
          ? 'No se puede: crearía un ciclo en la red.'
          : err.status === 403
            ? 'Sin permiso para cambiar la jerarquía.'
            : err.message || 'Error.';
      toast.error('No se pudo reasignar', { description: msg });
    }
  };

  const close = () => {
    setReassignOpen(false);
    setNewParent(null);
    onClose();
  };

  return (
    <Drawer
      open={!!node}
      onOpenChange={(o) => !o && close()}
      title={node?.displayName || node?.username || 'Usuario'}
      subtitle={node ? `@${node.username}` : undefined}
    >
      {node && (
        <div className="flex flex-col gap-5">
          {/* Chips: rol + estado */}
          <div className="flex flex-wrap items-center gap-2">
            {role && (
              <span
                className="inline-flex items-center gap-1.5 px-2 h-6 text-[11px] rounded border"
                style={{
                  color: role.color,
                  borderColor: `${role.color}55`,
                  backgroundColor: `${role.color}14`,
                }}
              >
                {role.label}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-2 h-6 text-[11px] rounded border border-[var(--color-border)] text-[var(--color-fg-muted)]">
              {STATUS_LABEL[node.status] ?? node.status}
            </span>
            {node.isIndependentBranch && (
              <span className="inline-flex items-center gap-1.5 px-2 h-6 text-[11px] rounded border border-[#A78BFA55] text-[#A78BFA] bg-[#A78BFA14]">
                Red independiente
              </span>
            )}
          </div>

          {/* Info del row */}
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <Info label="Padre actual" value={row?.parentUsername ? `@${row.parentUsername}` : '—'} />
            <Info label="Balance" value={row?.walletBalance != null ? `${row.walletBalance} fichas` : '—'} />
            <Info label="Bono" value={row?.bonusBalance != null ? `${row.bonusBalance} fichas` : '—'} />
            <Info label="Email" value={row?.email || '—'} />
          </div>

          {/* Acciones */}
          <div className="flex flex-col gap-2.5 pt-1 border-t border-[var(--color-border)]">
            <Link href={`/users/${node.id}`} className="w-full">
              <Button variant="secondary" size="md" className="w-full justify-center">
                <ExternalLink className="size-3.5" />
                Ver perfil completo
              </Button>
            </Link>

            {row ? (
              <UserActionsCell user={row} variant="sheet" onSuccess={onChanged} />
            ) : (
              <div className="h-10 rounded bg-[var(--color-bg-subtle)] animate-pulse" />
            )}

            {/* Reasignar de padre */}
            {!reassignOpen ? (
              <Button
                variant="secondary"
                size="md"
                className="w-full justify-center"
                onClick={() => setReassignOpen(true)}
              >
                <GitFork className="size-3.5" />
                Reasignar de padre
              </Button>
            ) : (
              <div className="flex flex-col gap-2.5 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-medium">
                    Nuevo padre
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setReassignOpen(false);
                      setNewParent(null);
                    }}
                    className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                <UserSelect
                  value={newParent}
                  onSelect={setNewParent}
                  excludeUserId={node.id}
                  includeSelf
                  placeholder="Buscar nuevo jefe (incluye admin / la casa)…"
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setReassignOpen(false);
                      setNewParent(null);
                    }}
                    disabled={setParent.isPending}
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void handleReassign()}
                    disabled={!newParent || setParent.isPending}
                  >
                    {setParent.isPending ? 'Guardando…' : 'Confirmar'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span className={cn('text-[12px] text-[var(--color-fg)] truncate')}>{value}</span>
    </div>
  );
}
