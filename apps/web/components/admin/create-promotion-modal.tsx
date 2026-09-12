/**
 * CreatePromotionModal — crear una promotion nueva.
 *
 * Versión 2: más didáctico, especialmente para daily_wheel.
 *
 * - Defaults inteligentes por type (wheel → status active).
 * - Code auto-generado del nombre.
 * - Fechas colapsadas en "Avanzado" para types perpetuos (wheel).
 * - drawAt oculto para wheel.
 * - Card explicativa para daily_wheel.
 *
 * Funder: el backend usa al actor como funder (igual pattern que bonuses).
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Sparkles, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
  useCreatePromotion,
  type CreatePromotionPayload,
  type PromotionStatus,
  type PromotionType,
} from '@/lib/hooks/use-promotions';
import { useActiveBonusDefinitions } from '@/lib/hooks/use-bonuses';
import { cn } from '@/lib/cn';
import { arDatetimeLocalToIso } from '@/lib/format-date';
import {
  parseStreakConfig,
  StreakConfigEditor,
} from './streak-config-editor';
import {
  parseWheelConfig,
  WheelConfigEditor,
} from './wheel-config-editor';

const PROMOTION_TYPES: { value: PromotionType; label: string; hint: string }[] = [
  { value: 'daily_wheel', label: 'Ruleta diaria', hint: '1 giro/día. Vos fondeás los premios.' },
  { value: 'login_streak', label: 'Racha de login', hint: 'Premios por días consecutivos.' },
  { value: 'lottery_tickets', label: 'Lotería (tickets)', hint: 'Tickets que se sortean.' },
  { value: 'lottery_ranking', label: 'Lotería (ranking)', hint: 'Ranking por score.' },
  { value: 'missions', label: 'Misiones', hint: 'Objetivos con reward.' },
  { value: 'level_chests', label: 'Cofres por nivel', hint: 'Cofres al subir nivel.' },
];

const PROMOTION_STATUSES: { value: PromotionStatus; label: string }[] = [
  { value: 'draft', label: 'Borrador' },
  { value: 'scheduled', label: 'Programada' },
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
    'daily_wheel',
    'login_streak',
    'lottery_tickets',
    'lottery_ranking',
    'missions',
    'level_chests',
  ]),
  status: z.enum(['draft', 'scheduled', 'active']),
  startsAt: z.string().optional().or(z.literal('')),
  endsAt: z.string().optional().or(z.literal('')),
  drawAt: z.string().optional().or(z.literal('')),
  configJson: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || isValidJson(v), { message: 'JSON inválido.' }),
  prizesJson: z
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

function parseJson(v?: string): Record<string, unknown> | undefined {
  if (!v || v.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(v);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* swallowed — validado por zod */
  }
  return undefined;
}

function toIso(local?: string): string | undefined {
  if (!local) return undefined;
  return arDatetimeLocalToIso(local);
}

/** Slugifica el nombre para generar el code automáticamente. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50);
}

interface CreatePromotionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreatePromotionModal({
  open,
  onOpenChange,
}: CreatePromotionModalProps) {
  const create = useCreatePromotion();
  const bonusDefs = useActiveBonusDefinitions();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: '',
      name: '',
      type: 'daily_wheel',
      status: 'active',
      startsAt: '',
      endsAt: '',
      drawAt: '',
      configJson: '',
      prizesJson: '',
    },
  });

  useEffect(() => {
    if (!open) {
      reset();
      setShowAdvanced(false);
      setCodeManuallyEdited(false);
    }
  }, [open, reset]);

  const selectedType = watch('type');
  const watchedName = watch('name');
  const useVisualEditor =
    selectedType === 'daily_wheel' || selectedType === 'login_streak';
  const isWheel = selectedType === 'daily_wheel';
  const showDrawAt = selectedType === 'lottery_tickets' || selectedType === 'lottery_ranking';

  // Auto-generate code from name
  useEffect(() => {
    if (!codeManuallyEdited && watchedName) {
      setValue('code', slugify(watchedName), { shouldValidate: true });
    }
  }, [watchedName, codeManuallyEdited, setValue]);

  // Auto-set status for wheel
  useEffect(() => {
    if (isWheel) {
      setValue('status', 'active', { shouldValidate: true });
    }
  }, [isWheel, setValue]);

  const watchedConfig = watch('configJson');
  const parsedRaw = useMemo<unknown>(() => {
    if (!watchedConfig) return {};
    try {
      return JSON.parse(watchedConfig);
    } catch {
      return {};
    }
  }, [watchedConfig]);
  const parsedWheel = useMemo(
    () => parseWheelConfig(parsedRaw),
    [parsedRaw],
  );
  const parsedStreak = useMemo(
    () => parseStreakConfig(parsedRaw),
    [parsedRaw],
  );

  function commitConfig(next: unknown): void {
    setValue('configJson', JSON.stringify(next, null, 2), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  const onSubmit = handleSubmit(async (values) => {
    const payload: CreatePromotionPayload = {
      code: values.code,
      name: values.name,
      type: values.type,
      status: values.status,
      startsAt: toIso(values.startsAt),
      endsAt: toIso(values.endsAt),
      drawAt: toIso(values.drawAt),
      config: parseJson(values.configJson),
      prizes: parseJson(values.prizesJson),
    };
    try {
      const created = await create.mutateAsync(payload);
      toast.success('Promoción creada', {
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
      title="Crear promoción"
      description="El actor queda como funder de los premios. Podés editar todo después en el detalle."
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
            form="create-promotion-form"
            disabled={create.isPending}
          >
            {create.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Creando…
              </>
            ) : (
              <>
                <Sparkles className="size-3.5" />
                Crear
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="create-promotion-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        {/* Tipo */}
        <FormField
          id="cp-type"
          label="Tipo de promoción"
          required
          error={errors.type?.message}
        >
          <Select id="cp-type" invalid={!!errors.type} {...register('type')}>
            {PROMOTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </FormField>

        {/* Card explicativa para wheel */}
        {isWheel && (
          <div className="flex gap-3 p-3 rounded-[var(--radius)] bg-[var(--color-accent-subtle)] border border-[var(--color-accent-border)]">
            <Info className="size-4 text-[var(--color-accent-text)] shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1 text-[12px] text-[var(--color-fg)]">
              <span className="font-medium">Ruleta diaria</span>
              <span className="text-[var(--color-fg-muted)]">
                Cada jugador puede girar <strong>1 vez por día</strong>. Los premios salen de tu saldo (como funder). Elegí los gajos y sus probabilidades en la configuración de abajo.
              </span>
            </div>
          </div>
        )}

        {/* Nombre + Code */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            id="cp-name"
            label="Nombre visible"
            required
            error={errors.name?.message}
            hint="El nombre que ven los jugadores."
          >
            <Input
              id="cp-name"
              type="text"
              invalid={!!errors.name}
              placeholder={isWheel ? 'Ruleta diaria' : 'Nombre de la promo'}
              {...register('name')}
            />
          </FormField>

          <FormField
            id="cp-code"
            label="Código interno"
            required
            error={errors.code?.message}
            hint="Único. Se genera del nombre, pero podés editarlo."
          >
            <Input
              id="cp-code"
              type="text"
              invalid={!!errors.code}
              placeholder="ruleta_diaria"
              {...register('code')}
              className="font-mono"
              onChange={(e) => {
                setCodeManuallyEdited(true);
                register('code').onChange(e);
              }}
            />
          </FormField>
        </div>

        {/* Status (solo se muestra si NO es wheel, porque wheel siempre es active) */}
        {!isWheel && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              id="cp-status"
              label="Estado inicial"
              required
              error={errors.status?.message}
              hint="Recomendado 'draft' — activá cuando esté configurada."
            >
              <Select
                id="cp-status"
                invalid={!!errors.status}
                {...register('status')}
              >
                {PROMOTION_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        )}

        {/* Config visual */}
        {useVisualEditor ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-medium text-[var(--color-fg)]">
                Configuración
              </span>
              {errors.configJson?.message && (
                <span className="text-[11px] text-[var(--color-accent-text)]">
                  {errors.configJson.message}
                </span>
              )}
            </div>
            {isWheel ? (
              <WheelConfigEditor
                value={parsedWheel}
                onChange={(c) => commitConfig(c)}
                bonusDefinitions={bonusDefs.data?.data ?? []}
              />
            ) : (
              <StreakConfigEditor
                value={parsedStreak}
                onChange={(c) => commitConfig(c)}
              />
            )}
          </div>
        ) : (
          <>
            <FormField
              id="cp-config"
              label="Config (JSON)"
              error={errors.configJson?.message}
              hint="Estructura libre por tipo."
            >
              <textarea
                id="cp-config"
                rows={4}
                aria-invalid={!!errors.configJson}
                placeholder={'{\n  "key": "value"\n}'}
                className={textareaClass(!!errors.configJson)}
                {...register('configJson')}
              />
            </FormField>

            <FormField
              id="cp-prizes"
              label="Prizes (JSON)"
              error={errors.prizesJson?.message}
              hint="Estructura libre."
            >
              <textarea
                id="cp-prizes"
                rows={3}
                aria-invalid={!!errors.prizesJson}
                placeholder={'{\n  "day1": { "type": "bonus", "amount": 100 }\n}'}
                className={textareaClass(!!errors.prizesJson)}
                {...register('prizesJson')}
              />
            </FormField>
          </>
        )}

        {/* Avanzado: fechas */}
        <div className="border border-[var(--color-border)] rounded-[var(--radius)]">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center justify-between w-full px-3 py-2 text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
          >
            <span>Opciones avanzadas (fechas)</span>
            {showAdvanced ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
          {showAdvanced && (
            <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                id="cp-starts"
                label="Empieza"
                error={errors.startsAt?.message}
                hint="Opcional. Si no se setea, la promo empieza ya."
              >
                <Input
                  id="cp-starts"
                  type="datetime-local"
                  invalid={!!errors.startsAt}
                  {...register('startsAt')}
                />
              </FormField>
              <FormField
                id="cp-ends"
                label="Termina"
                error={errors.endsAt?.message}
                hint="Opcional. Si no se setea, corre siempre."
              >
                <Input
                  id="cp-ends"
                  type="datetime-local"
                  invalid={!!errors.endsAt}
                  {...register('endsAt')}
                />
              </FormField>
              {showDrawAt && (
                <FormField
                  id="cp-draw"
                  label="Sorteo"
                  error={errors.drawAt?.message}
                  hint="Fecha del sorteo (solo lotería)."
                >
                  <Input
                    id="cp-draw"
                    type="datetime-local"
                    invalid={!!errors.drawAt}
                    {...register('drawAt')}
                  />
                </FormField>
              )}
            </div>
          )}
        </div>
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
    if (err.code === 'PROMOTION_CODE_CONFLICT') {
      return 'Ya existe una promoción con ese código.';
    }
    return err.message || 'Conflicto al procesar.';
  }
  if (err.status === 403) return 'No tenés permiso para crear promociones.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}
