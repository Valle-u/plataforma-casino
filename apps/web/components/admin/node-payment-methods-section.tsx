'use client';

import { CreditCard, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { isApiError } from '@/lib/api-client';
import {
  useNodePaymentMethods,
  useArchiveNodePaymentMethod,
} from '@/lib/hooks/use-payment-methods';
import { cn } from '@/lib/cn';
import { CreateNodePaymentMethodModal } from './create-node-payment-method-modal';

export function NodePaymentMethodsSection() {
  const { data, isLoading, isError, refetch, isFetching } = useNodePaymentMethods();
  const archive = useArchiveNodePaymentMethod();
  const [showCreate, setShowCreate] = useState(false);

  const handleArchive = async (id: string) => {
    try {
      await archive.mutateAsync(id /* pasamos por closure */);
      toast.success('Método archivado');
    } catch (err) {
      toast.error('No se pudo archivar', {
        description: isApiError(err) ? err.message : 'Error inesperado',
      });
    }
  };

  const methods = data?.data ?? [];

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <CreditCard className="size-3" />
          Mis métodos de pago
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('size-3', isFetching && 'animate-spin')} />
            Refrescar
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="size-3" />
            Crear método
          </Button>
        </div>
      </header>

      {isLoading && (
        <div className="p-6 text-center text-[12px] text-[var(--color-fg-muted)]">
          Cargando métodos…
        </div>
      )}

      {isError && (
        <EmptyState hint="node-pm" label="Error al cargar métodos de pago." />
      )}

      {!isLoading && !isError && methods.length === 0 && (
        <EmptyState
          hint="node-pm-empty"
          label="Todavía no configuraste métodos de pago. Creá uno para que tus jugadores puedan depositar."
        />
      )}

      {methods.length > 0 && (
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Código</TH>
                <TH>Nombre</TH>
                <TH>Tipo</TH>
                <TH>Ratio</TH>
                <TH>Estado</TH>
                <TH className="w-0" />
              </TR>
            </THead>
            <TBody>
              {methods.map((m) => (
                <TR key={m.id}>
                  <TD className="font-mono text-[12px]">{m.code}</TD>
                  <TD>{m.name}</TD>
                  <TD className="text-[11px] text-[var(--color-fg-muted)] capitalize">
                    {labelType(m.type)}
                  </TD>
                  <TD className="num font-mono text-[12px]">
                    {m.chipsPerUnit}
                  </TD>
                  <TD>
                    <Badge variant={m.isActive ? 'success' : 'neutral'}>
                      {m.isActive ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </TD>
                  <TD>
                    {m.isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleArchive(m.id)}
                        disabled={archive.isPending}
                        className="text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]"
                        title="Archivar"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      <p className="text-[10px] text-[var(--color-fg-subtle)] italic">
        Estos métodos los ven tus jugadores al depositar. Cada método necesita
        datos propios (CBU, address, etc.) que se configuran al crearlo.
      </p>

      <CreateNodePaymentMethodModal open={showCreate} onOpenChange={setShowCreate} />
    </section>
  );
}

function labelType(type: string): string {
  switch (type) {
    case 'bank_transfer':
      return 'Transferencia bancaria';
    case 'crypto':
      return 'Cripto';
    default:
      return type;
  }
}
