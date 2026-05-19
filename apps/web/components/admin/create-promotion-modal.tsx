/**
 * CreatePromotionModal â€” crear una promotion nueva.
 *
 * ValidaciÃ³n cliente:
 *   - code: regex backend (`^[a-z0-9][a-z0-9_-]{1,49}$`).
 *   - name: 3-120 chars.
 *   - type: enum cerrado.
 *   - status: default 'draft' (recomendado para nuevas; cambiar a 'scheduled'
 *     o 'active' despuÃ©s de configurar prizes via Edit drawer).
 *   - dates: ISO opcionales.
 *   - config / prizes: JSON crudo (textarea). Para MVP no validamos shape
 *     por type â€” la validaciÃ³n fina ocurre en cada service del backend
 *     cuando el type lo necesita.
 *
 * Funder: el backend usa al actor como funder (igual pattern que bonuses).
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Sparkles } from 'lucide-react';
import { useEffect, useMemo } from 'react';
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
import { cn } from '@/lib/cn';
import {
  parseStreakConfig,
  StreakConfigEditor,
} from './streak-config-editor';
import {
  parseWheelConfig,
  WheelConfigEditor,
} from './wheel-config-editor';

const PROMOTION_TYPES: { value: PromotionType; label: string }[] = [
  { value: 'daily_wheel', label: 'Ruleta diaria' },
  { value: 'login_streak', label: 'Racha de login' },
  { value: 'lottery_tickets', label: 'LoterÃ­a (tickets)' },
  { value: 'lottery_ranking', label: 'LoterÃ­a (ranking)' },
  { value: 'missions', label: 'Misiones' },
  { value: 'level_chests', label: 'Cofres por nivel' },
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
    .min(2, 'MÃ­nimo 2 caracteres.')
    .max(50, 'MÃ¡ximo 50 caracteres.')
    .regex(codeRegex, 'Lowercase + dÃ­gitos + _- (debe empezar con letra/dÃ­gito).'),
  name: z
    .string()
    .min(3, 'MÃ­nimo 3 caracteres.')
    .max(120, 'MÃ¡ximo 120 caracteres.'),
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
    .refine((v) => !v || isValidJson(v), { message: 'JSON invÃ¡lido.' }),
  prizesJson: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || isValidJson(v), { message: 'JSON invÃ¡lido.' }),
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
    /* swallowed â€” validado por zod */
  }
  return undefined;
}

function toIso(local?: string): string | undefined {
  if (!local) return undefined;
  return new Date(local).toISOString();
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
      status: 'draft',
      startsAt: '',
      endsAt: '',
      drawAt: '',
      configJson: '',
      prizesJson: '',
    },
  });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const selectedType = watch('type');
  const useVisualEditor =
    selectedType === 'daily_wheel' || selectedType === 'login_streak';

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
      type: values.type as PromotionType,
      status: values.status as PromotionStatus,
      startsAt: toIso(values.startsAt),
      endsAt: toIso(values.endsAt),
      drawAt: toIso(values.drawAt),
      config: parseJson(values.configJson),
      prizes: parseJson(values.prizesJson),
    };
    try {
      const created = await create.mutateAsync(payload);
      toast.success('PromociÃ³n creada', {
        description: `${created.code} Â· ${created.type} Â· ${created.status}`,
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
      title="Crear promociÃ³n"
      description="El actor queda como funder de los premios. PodÃ©s editar todo despuÃ©s en el detalle."
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
                Creandoâ€¦
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            id="cp-code"
            label="CÃ³digo"
            required
            error={errors.code?.message}
            hint="lowercase + [a-z0-9_-]. Ãšnico intra-tenant."
          >
            <Input
              id="cp-code"
              type="text"
              invalid={!!errors.code}
              placeholder="ruleta_diaria_2026"
              {...register('code')}
              className="font-mono"
            />
          </FormField>

          <FormField
            id="cp-name"
            label="Nombre visible"
            required
            error={errors.name?.message}
            hint="El nombre que ven los users (3-120 chars)."
          >
            <Input
              id="cp-name"
              type="text"
              invalid={!!errors.name}
              placeholder="Ruleta diaria"
              {...register('name')}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            id="cp-type"
            label="Tipo"
            required
            error={errors.type?.message}
            hint={describeType(selectedType as PromotionType)}
          >
            <Select id="cp-type" invalid={!!errors.type} {...register('type')}>
              {PROMOTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            id="cp-status"
            label="Estado inicial"
            required
            error={errors.status?.message}
            hint="Recomendado 'draft' â€” activÃ¡ cuando estÃ© configurada."
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            id="cp-starts"
            label="Empieza"
            error={errors.startsAt?.message}
            hint="Opcional. Local time."
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
            hint="Opcional. NULL = perpetua."
          >
            <Input
              id="cp-ends"
              type="datetime-local"
              invalid={!!errors.endsAt}
              {...register('endsAt')}
            />
          </FormField>
          <FormField
            id="cp-draw"
            label="Sorteo"
            error={errors.drawAt?.message}
            hint="Para lottery_*."
          >
            <Input
              id="cp-draw"
              type="datetime-local"
              invalid={!!errors.drawAt}
              {...register('drawAt')}
            />
          </FormField>
        </div>

        {useVisualEditor ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-medium text-[var(--color-fg)]">
                ConfiguraciÃ³n
              </span>
              {errors.configJson?.message && (
                <span className="text-[11px] text-[var(--color-accent-text)]">
                  {errors.configJson.message}
                </span>
              )}
            </div>
            {selectedType === 'daily_wheel' ? (
              <WheelConfigEditor
                value={parsedWheel}
                onChange={(c) => commitConfig(c)}
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
              hint="Estructura libre por tipo (todavÃ­a sin editor visual)."
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
              hint="Estructura libre. Algunos tipos lo usan, otros lo tienen dentro de config."
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
      </form>
    </Modal>
  );
}

function describeType(t: PromotionType): string {
  switch (t) {
    case 'daily_wheel':
      return 'Ruleta diaria â€” el user gira 1 vez/dÃ­a.';
    case 'login_streak':
      return 'Premios por dÃ­as consecutivos de login.';
    case 'lottery_tickets':
      return 'Tickets que se sortean en draw_at.';
    case 'lottery_ranking':
      return 'Ranking por score; premios al close.';
    case 'missions':
      return 'Objetivos discretos con reward al cumplir.';
    case 'level_chests':
      return 'Cofres al subir de nivel.';
  }
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
  if (!isApiError(err)) return 'Error de conexiÃ³n.';
  if (err.status === 409) {
    if (err.code === 'PROMOTION_CODE_CONFLICT') {
      return 'Ya existe una promociÃ³n con ese cÃ³digo.';
    }
    return err.message || 'Conflicto al procesar.';
  }
  if (err.status === 403) return 'No tenÃ©s permiso para crear promociones.';
  if (err.status === 400) return err.message || 'Datos invÃ¡lidos.';
  return err.message || 'Error inesperado.';
}
