/**
 * CreateBonusDefinitionModal — crea una plantilla de bono.
 *
 * Espeja `CreateBonusDefinitionDto` del backend:
 *   - code: lowercase + [a-z0-9_-], único intra-tenant.
 *   - name: 3-120 chars.
 *   - type: enum cerrado (welcome/reload/manual/free_spins/no_deposit/referral).
 *   - status inicial: draft (default) o active.
 *   - expirationDays: int 1-3650.
 *   - config: JSON crudo (validación fina pendiente — el backend acepta cualquier object).
 *
 * Funder: el actor implícito (resuelto en backend). Sin selector.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Gift } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { isApiError } from '@/lib/api-client';
import {
  useCreateBonusDefinition,
  type BonusDefinitionStatus,
  type BonusType,
  type CreateBonusDefinitionPayload,
} from '@/lib/hooks/use-bonuses';
import { cn } from '@/lib/cn';

const TYPES: { value: BonusType; label: string; hint: string }[] = [
  { value: 'welcome', label: 'Welcome', hint: 'Bono inicial al primer depósito.' },
  { value: 'reload', label: 'Reload', hint: 'Re-depósito recurrente.' },
  { value: 'manual', label: 'Manual', hint: 'Monto fijo: se acredita exactamente ese monto al otorgarlo (manual o al aprobar un depósito); no se puede poner otro.' },
  { value: 'free_spins', label: 'Free spins', hint: 'Tiradas gratis en slots.' },
  { value: 'no_deposit', label: 'No deposit', hint: 'Bono sin requerir depósito.' },
  { value: 'referral', label: 'Referral', hint: 'Bono por traer un nuevo user.' },
];

const STATUS_OPTIONS: { value: BonusDefinitionStatus; label: string }[] = [
  { value: 'draft', label: 'Borrador' },
  { value: 'active', label: 'Activa' },
];

const codeRegex = /^[a-z0-9][a-z0-9_-]{1,49}$/;

const schema = z.object({
  code: z
    .string()
    .min(2, 'Mínimo 2 caracteres.')
    .max(50, 'Máximo 50 caracteres.')
    .regex(codeRegex, 'Lowercase + dígitos + _- (debe empezar con letra/dígito).'),
  name: z
    .string()
    .min(3, 'Mínimo 3 caracteres.')
    .max(120, 'Máximo 120 caracteres.'),
  type: z.enum([
    'welcome',
    'reload',
    'manual',
    'free_spins',
    'no_deposit',
    'referral',
  ]),
  status: z.enum(['draft', 'active']),
  expirationDays: z
    .string()
    .min(1, 'Requerido.')
    .regex(/^\d+$/, 'Solo dígitos.')
    .refine((v) => {
      const n = Number(v);
      return n >= 1 && n <= 3650;
    }, 'Entre 1 y 3650 días.'),
  configJson: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || isValidJson(v), { message: 'JSON inválido.' }),
});

type FormValues = z.infer<typeof schema>;

function isValidJson(v: string): boolean {
  try {
    JSON.parse(v);
    return true;
  } catch {
    return false;
  }
}

function parseJsonOpt(v?: string): Record<string, unknown> | undefined {
  if (!v || v.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(v);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* validado por zod */
  }
  return undefined;
}

interface CreateBonusDefinitionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateBonusDefinitionModal({
  open,
  onOpenChange,
}: CreateBonusDefinitionModalProps) {
  const create = useCreateBonusDefinition();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: '',
      name: '',
      type: 'welcome',
      status: 'draft',
      expirationDays: '30',
      configJson: '',
    },
  });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const selectedType = watch('type');
  const typeHint = TYPES.find((t) => t.value === selectedType)?.hint;

  const onSubmit = handleSubmit(async (values) => {
    const payload: CreateBonusDefinitionPayload = {
      code: values.code,
      name: values.name,
      type: values.type,
      status: values.status,
      expirationDays: Number(values.expirationDays),
      config: parseJsonOpt(values.configJson),
    };
    try {
      const created = await create.mutateAsync(payload);
      toast.success('Definition creada', {
        description: `${created.code} · ${created.type} · ${created.status}`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo crear', { description: mapError(err) });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Crear definition de bono"
      description="El actor queda como funder. Después se puede editar en el detalle."
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="create-bonus-def-form"
            disabled={create.isPending}
          >
            {create.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Creando…
              </>
            ) : (
              <>
                <Gift className="size-3.5" />
                Crear
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="create-bonus-def-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            id="bd-code"
            label="Código"
            required
            error={errors.code?.message}
            hint="lowercase + [a-z0-9_-]. Único intra-tenant."
          >
            <Input
              id="bd-code"
              type="text"
              invalid={!!errors.code}
              placeholder="welcome_2026"
              {...register('code')}
              className="font-mono"
            />
          </FormField>

          <FormField
            id="bd-name"
            label="Nombre visible"
            required
            error={errors.name?.message}
          >
            <Input
              id="bd-name"
              type="text"
              invalid={!!errors.name}
              placeholder="Bono de bienvenida"
              {...register('name')}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            id="bd-type"
            label="Tipo"
            required
            error={errors.type?.message}
            hint={typeHint}
          >
            <Select id="bd-type" invalid={!!errors.type} {...register('type')}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            id="bd-status"
            label="Estado inicial"
            required
            error={errors.status?.message}
            hint="Recomendado 'draft' — activá cuando esté configurada."
          >
            <Select
              id="bd-status"
              invalid={!!errors.status}
              {...register('status')}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <FormField
          id="bd-expiration"
          label="Días para expirar"
          required
          error={errors.expirationDays?.message}
          hint="Entre 1 y 3650. Default 30."
        >
          <Input
            id="bd-expiration"
            type="number"
            min={1}
            max={3650}
            step={1}
            invalid={!!errors.expirationDays}
            {...register('expirationDays')}
            className="font-mono w-32"
          />
        </FormField>

        <FormField
          id="bd-config"
          label="Config (JSON)"
          error={errors.configJson?.message}
          hint="Estructura libre por tipo. Ej welcome: { matchPct: 100, capChips: '500' }."
        >
          <textarea
            id="bd-config"
            rows={4}
            aria-invalid={!!errors.configJson}
            placeholder={'{\n  "matchPct": 100,\n  "capChips": "500"\n}'}
            className={textareaClass(!!errors.configJson)}
            {...register('configJson')}
          />
        </FormField>
      </form>
    </Modal>
  );
}

function textareaClass(invalid: boolean): string {
  return cn(
    'flex w-full px-3 py-2 resize-y min-h-[80px]',
    'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
    'border border-[var(--color-border)]',
    'placeholder:text-[var(--color-fg-subtle)]',
    'text-[12px] leading-relaxed font-mono',
    'transition-[border-color,box-shadow] duration-150',
    'hover:border-[var(--color-border-strong)]',
    'focus:outline-none focus:border-[var(--color-accent)]',
    'focus:shadow-[0_0_0_3px_var(--color-accent-glow)]',
    invalid && 'border-[var(--color-accent)] shadow-[0_0_0_3px_var(--color-accent-glow)]',
  );
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 409) {
    if (err.code === 'BONUS_DEFINITION_CODE_CONFLICT') {
      return 'Ya existe una definition con ese código.';
    }
    return err.message || 'Conflicto al procesar.';
  }
  if (err.status === 403) return 'No tenés permiso para crear definitions.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}
