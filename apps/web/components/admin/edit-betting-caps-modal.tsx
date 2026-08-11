/**
 * EditBettingCapsModal — configura los topes de apuesta (Parte B, B-build-4b).
 *
 * Dos topes mensuales de turnover: por jugador y global del tenant. 0 = sin
 * tope. Al superarse, las apuestas se BLOQUEAN (protección de exposición ante
 * el provider externo). Requiere `tenant.settings.edit`.
 */

'use client';

import { Check, Info } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { isApiError } from '@/lib/api-client';
import {
  useSetBettingCaps,
  type BettingCapsStatus,
} from '@/lib/hooks/use-house';

interface EditBettingCapsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: BettingCapsStatus | undefined;
}

export function EditBettingCapsModal({
  open,
  onOpenChange,
  current,
}: EditBettingCapsModalProps) {
  const setCaps = useSetBettingCaps();
  // Inputs NO controlados (ref): tipear no re-renderiza el modal (evita perder
  // el foco en Opera). Se pre-cargan con defaultValue y se leen al confirmar.
  const playerRef = useRef<HTMLInputElement>(null);
  const globalRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(): Promise<void> {
    const p = Number(playerRef.current?.value ?? '0');
    const g = Number(globalRef.current?.value ?? '0');
    if (!Number.isFinite(p) || p < 0 || !Number.isFinite(g) || g < 0) {
      toast.error('Los topes deben ser números mayores o iguales a 0.');
      return;
    }
    try {
      await setCaps.mutateAsync({ playerMonthly: p, globalMonthly: g });
      toast.success('Topes de apuesta actualizados');
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo guardar', { description: mapError(err) });
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Topes de apuesta"
      description="Limitan el volumen apostado por mes. Al superarse, las apuestas se bloquean."
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={setCaps.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="button"
            onClick={handleSubmit}
            disabled={setCaps.isPending}
          >
            {setCaps.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Guardando…
              </>
            ) : (
              <>
                <Check className="size-3.5" />
                Guardar
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
          <Info className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <span className="text-[12px] text-[var(--color-fg)] leading-snug">
            Es el máximo de <strong>fichas apostadas por mes</strong> (turnover).
            Poné <strong>0</strong> para sin tope. Protege contra que un bug o
            fraude dispare el volumen y te genere deuda con el proveedor externo.
          </span>
        </div>

        <FormField
          id="cap-player"
          label="Tope por jugador / mes"
          hint="Cuánto puede apostar como máximo un solo jugador por mes. 0 = sin tope."
        >
          <Input
            id="cap-player"
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            className="font-mono"
            ref={playerRef}
            defaultValue={String(current?.caps.playerMonthly ?? 0)}
          />
        </FormField>

        <FormField
          id="cap-global"
          label="Tope global del tenant / mes"
          hint="Techo total de lo que se puede apostar en todo el casino por mes. 0 = sin tope."
        >
          <Input
            id="cap-global"
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            className="font-mono"
            ref={globalRef}
            defaultValue={String(current?.caps.globalMonthly ?? 0)}
          />
        </FormField>
      </div>
    </Modal>
  );
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return 'No tenés permiso para configurar los topes.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}
