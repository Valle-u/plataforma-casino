/**
 * SectionCuentasBancarias — las cuentas bancarias PROPIAS del tenant.
 *
 * Por qué existe: al cargar una transferencia, el titular y el banco de nuestra
 * cuenta se escribían a mano en dos cajas de texto libre. Nada impedía poner ahí
 * un tercero, y es lo que pasó — quedó una transferencia entrante con el nombre
 * del jugador cargado como titular de NUESTRA cuenta.
 *
 * Se definen acá una vez; el formulario de transferencias las elige de una
 * lista.
 *
 * La baja es LÓGICA: una cuenta cerrada sale del selector, pero las
 * transferencias que se cargaron con ella la siguen mostrando. Borrarla dejaría
 * huérfano un dato de auditoría de plata real.
 */

'use client';

import { Landmark, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import {
  useBankAccounts,
  useCreateBankAccount,
  useSetBankAccountActive,
  useUpdateBankAccount,
  type BankAccount,
} from '@/lib/hooks/use-bank-accounts';
import { cn } from '@/lib/cn';

export function SectionCuentasBancarias() {
  // `true`: acá se administran, así que también se ven las dadas de baja para
  // poder reactivarlas. El selector del formulario pide solo las activas.
  const { data, isLoading, isError } = useBankAccounts(true);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [creating, setCreating] = useState(false);

  const accounts = data?.data ?? [];
  const activas = accounts.filter((a) => a.isActive);
  const inactivas = accounts.filter((a) => !a.isActive);

  if (isLoading) return <Skeleton className="h-64" />;
  if (isError) {
    return (
      <EmptyState hint="bank-accounts" label="Error al cargar las cuentas." />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-[17px] tracking-tight text-[var(--color-fg)]">
            Cuentas bancarias propias
          </h2>
          <p className="text-[12.5px] text-[var(--color-fg-muted)] leading-relaxed max-w-[560px]">
            Las cuentas <strong>tuyas</strong> con las que recibís y enviás
            transferencias. Al cargar una transferencia elegís una de estas, así
            no se puede escribir por error los datos de un tercero.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          Agregar cuenta
        </Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          hint="bank-accounts"
          label="Todavía no cargaste ninguna cuenta. Agregá la primera para poder elegirla al registrar transferencias."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <AccountList
            accounts={activas}
            onEdit={setEditing}
            emptyLabel="Ninguna cuenta activa."
          />
          {inactivas.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                Dadas de baja
              </span>
              <AccountList
                accounts={inactivas}
                onEdit={setEditing}
                emptyLabel=""
              />
            </div>
          )}
        </div>
      )}

      {(creating || editing) && (
        <AccountModal
          account={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AccountList({
  accounts,
  onEdit,
  emptyLabel,
}: {
  accounts: BankAccount[];
  onEdit: (a: BankAccount) => void;
  emptyLabel: string;
}) {
  const setActive = useSetBankAccountActive();

  if (accounts.length === 0) {
    return emptyLabel ? (
      <p className="text-[12px] text-[var(--color-fg-subtle)]">{emptyLabel}</p>
    ) : null;
  }

  async function toggle(a: BankAccount) {
    try {
      await setActive.mutateAsync({ id: a.id, isActive: !a.isActive });
      toast.success(a.isActive ? 'Cuenta dada de baja' : 'Cuenta reactivada');
    } catch (err) {
      toast.error(
        isApiError(err) ? err.message : 'No se pudo cambiar el estado',
      );
    }
  }

  return (
    <div className="flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)]">
      {accounts.map((a) => (
        <div
          key={a.id}
          className={cn(
            'flex items-center gap-3 px-3 py-2.5',
            !a.isActive && 'opacity-60',
          )}
        >
          <Landmark className="size-4 shrink-0 text-[var(--color-fg-subtle)]" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] text-[var(--color-fg)]">
              {a.label}
            </span>
            <span className="truncate text-[11px] text-[var(--color-fg-muted)]">
              {a.accountHolder} · {a.bankName}
              {a.accountIdentifier && (
                <span className="text-[var(--color-fg-subtle)]">
                  {' · '}
                  {a.accountIdentifier}
                </span>
              )}
            </span>
          </div>
          {!a.isActive && (
            <Badge variant="neutral" className="ml-1 shrink-0">
              De baja
            </Badge>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(a)}
              aria-label="Editar cuenta"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void toggle(a)}
              disabled={setActive.isPending}
              aria-label={a.isActive ? 'Dar de baja' : 'Reactivar'}
              title={
                a.isActive
                  ? 'Deja de ofrecerse al cargar transferencias. Las que ya la usaron no se tocan.'
                  : 'Vuelve a ofrecerse al cargar transferencias.'
              }
            >
              {a.isActive ? (
                <X className="size-3.5" />
              ) : (
                <RotateCcw className="size-3.5" />
              )}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AccountModal({
  account,
  onClose,
}: {
  account: BankAccount | null;
  onClose: () => void;
}) {
  const create = useCreateBankAccount();
  const update = useUpdateBankAccount();
  const [label, setLabel] = useState(account?.label ?? '');
  const [accountHolder, setAccountHolder] = useState(
    account?.accountHolder ?? '',
  );
  const [bankName, setBankName] = useState(account?.bankName ?? '');
  const [accountIdentifier, setAccountIdentifier] = useState(
    account?.accountIdentifier ?? '',
  );

  const pending = create.isPending || update.isPending;
  const valid =
    label.trim() !== '' && accountHolder.trim() !== '' && bankName.trim() !== '';

  async function submit() {
    const input = {
      label: label.trim(),
      accountHolder: accountHolder.trim(),
      bankName: bankName.trim(),
      accountIdentifier: accountIdentifier.trim() || undefined,
    };
    try {
      if (account) {
        await update.mutateAsync({ id: account.id, ...input });
        toast.success('Cuenta actualizada');
      } else {
        await create.mutateAsync(input);
        toast.success('Cuenta agregada');
      }
      onClose();
    } catch (err) {
      toast.error(
        isApiError(err) ? err.message : 'No se pudo guardar la cuenta',
      );
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={account ? 'Editar cuenta' : 'Agregar cuenta propia'}
      description="Estos datos se copian a la transferencia cuando elegís esta cuenta."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || pending}>
            {account ? 'Guardar' : 'Agregar'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ba-label">Nombre para reconocerla</Label>
          <Input
            id="ba-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Mercado Pago principal"
          />
          <span className="text-[11px] text-[var(--color-fg-subtle)]">
            Es lo que vas a ver en la lista al cargar una transferencia.
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ba-holder">Titular de la cuenta</Label>
          <Input
            id="ba-holder"
            value={accountHolder}
            onChange={(e) => setAccountHolder(e.target.value)}
            placeholder="Julio Voltio"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ba-bank">Banco</Label>
          <Input
            id="ba-bank"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="Mercado Pago"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ba-id">CBU o alias (opcional)</Label>
          <Input
            id="ba-id"
            value={accountIdentifier}
            onChange={(e) => setAccountIdentifier(e.target.value)}
            placeholder="0000003100010000000001"
          />
          <span className="text-[11px] text-[var(--color-fg-subtle)]">
            Sirve para distinguir dos cuentas del mismo banco.
          </span>
        </div>
      </div>
    </Modal>
  );
}
