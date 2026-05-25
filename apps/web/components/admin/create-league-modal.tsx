/**
 * CreateLeagueModal — crear una league nueva.
 *
 * Diferencias con promotions:
 *   - `startsAt` y `endsAt` son OBLIGATORIOS (las leagues siempre tienen
 *     ventana — el cron `closeAndSettle` cierra al pasar `endsAt`).
 *   - No hay `status` inicial: backend default es 'scheduled'. El admin
 *     puede activarla después via edit.
 *   - `period` informativo (daily/weekly/monthly/season/custom).
 *   - `metric` es lo que se mide y rankea (bet_volume, rounds_count,
 *     gross_won, player_netwin, score_custom).
 *
 * Funder: el actor — backend lo resuelve. Sin selector.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Trophy } from 'lucide-react';
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
  useCreateLeague,
  type CreateLeaguePayload,
  type LeagueMetric,
  type LeaguePeriod,
} from '@/lib/hooks/use-leagues';
import { cn } from '@/lib/cn';

const PERIODS: { value: LeaguePeriod; label: string }[] = [
  { value: 'daily', label: 'Diaria' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensual' },
  { value: 'season', label: 'Temporada' },
  { value: 'custom', label: 'Custom' },
];

const METRICS: { value: LeagueMetric; label: string; hint: string }[] = [
  { value: 'bet_volume', label: 'Volumen apostado', hint: 'Suma de bets en el período.' },
  { value: 'rounds_count', label: 'Cantidad de rondas', hint: 'Cant. de game rounds jugadas.' },
  { value: 'gross_won', label: 'Ganancia bruta', hint: 'Suma de wins (sin restar bets).' },
  { value: 'player_netwin', label: 'NGR del jugador', hint: 'wins − bets (positivo = ganador).' },
  { value: 'score_custom', label: 'Score custom', hint: 'Requiere metricConfig.formula.' },
];

const codeRegex = /^[a-z0-9][a-z0-9_-]{1,49}$/;

const schema = z
  .object({
    code: z
      .string()
      .min(2, 'Mínimo 2 caracteres.')
      .max(50, 'Máximo 50 caracteres.')
      .regex(codeRegex, 'Lowercase + dígitos + _- (debe empezar con letra/dígito).'),
    name: z
      .string()
      .min(3, 'Mínimo 3 caracteres.')
      .max(120, 'Máximo 120 caracteres.'),
    period: z.enum(['daily', 'weekly', 'monthly', 'season', 'custom']),
    metric: z.enum([
      'bet_volume',
      'rounds_count',
      'gross_won',
      'player_netwin',
      'score_custom',
    ]),
    startsAt: z.string().min(1, 'Requerido.'),
    endsAt: z.string().min(1, 'Requerido.'),
    metricConfigJson: z
      .string()
      .optional()
      .or(z.literal(''))
      .refine((v) => !v || isValidJson(v), { message: 'JSON inválido.' }),
    prizesJson: z
      .string()
      .optional()
      .or(z.literal(''))
      .refine((v) => !v || isValidJson(v), { message: 'JSON inválido.' }),
  })
  .refine(
    (v) => new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(),
    {
      path: ['endsAt'],
      message: 'Termina debe ser posterior a Empieza.',
    },
  );

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

function toIso(local?: string): string {
  if (!local) return '';
  return new Date(local).toISOString();
}

interface CreateLeagueModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateLeagueModal({ open, onOpenChange }: CreateLeagueModalProps) {
  const create = useCreateLeague();
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
      period: 'weekly',
      metric: 'bet_volume',
      startsAt: '',
      endsAt: '',
      metricConfigJson: '',
      prizesJson: '',
    },
  });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const selectedMetric = watch('metric');
  const metricHint = METRICS.find((m) => m.value === selectedMetric)?.hint;

  const onSubmit = handleSubmit(async (values) => {
    const payload: CreateLeaguePayload = {
      code: values.code,
      name: values.name,
      period: values.period,
      metric: values.metric,
      startsAt: toIso(values.startsAt),
      endsAt: toIso(values.endsAt),
      metricConfig: parseJsonOpt(values.metricConfigJson),
      prizes: parseJsonOpt(values.prizesJson),
    };
    try {
      const created = await create.mutateAsync(payload);
      toast.success('Liga creada', {
        description: `${created.code} · ${created.period} · ${created.metric}`,
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
      title="Crear liga"
      description="El actor queda como funder de los premios. Status inicial: scheduled."
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
            form="create-league-form"
            disabled={create.isPending}
          >
            {create.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Creando…
              </>
            ) : (
              <>
                <Trophy className="size-3.5" />
                Crear
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="create-league-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            id="cl-code"
            label="Código"
            required
            error={errors.code?.message}
            hint="lowercase + [a-z0-9_-]."
          >
            <Input
              id="cl-code"
              type="text"
              invalid={!!errors.code}
              placeholder="liga_semanal_2026_w1"
              {...register('code')}
              className="font-mono"
            />
          </FormField>

          <FormField
            id="cl-name"
            label="Nombre visible"
            required
            error={errors.name?.message}
          >
            <Input
              id="cl-name"
              type="text"
              invalid={!!errors.name}
              placeholder="Liga semanal"
              {...register('name')}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            id="cl-period"
            label="Período"
            required
            error={errors.period?.message}
            hint="Informativo. El cierre depende de endsAt."
          >
            <Select id="cl-period" invalid={!!errors.period} {...register('period')}>
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            id="cl-metric"
            label="Métrica"
            required
            error={errors.metric?.message}
            hint={metricHint}
          >
            <Select id="cl-metric" invalid={!!errors.metric} {...register('metric')}>
              {METRICS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            id="cl-starts"
            label="Empieza"
            required
            error={errors.startsAt?.message}
            hint="Local time."
          >
            <Input
              id="cl-starts"
              type="datetime-local"
              invalid={!!errors.startsAt}
              {...register('startsAt')}
            />
          </FormField>
          <FormField
            id="cl-ends"
            label="Termina"
            required
            error={errors.endsAt?.message}
            hint="Local time. El cron cierra al pasar este momento."
          >
            <Input
              id="cl-ends"
              type="datetime-local"
              invalid={!!errors.endsAt}
              {...register('endsAt')}
            />
          </FormField>
        </div>

        {selectedMetric === 'score_custom' && (
          <FormField
            id="cl-metric-config"
            label="Metric config (JSON)"
            error={errors.metricConfigJson?.message}
            hint="Score custom requiere { formula: '...' }."
          >
            <textarea
              id="cl-metric-config"
              rows={3}
              aria-invalid={!!errors.metricConfigJson}
              placeholder={'{\n  "formula": "bet_volume * 2 + rounds_count"\n}'}
              className={textareaClass(!!errors.metricConfigJson)}
              {...register('metricConfigJson')}
            />
          </FormField>
        )}

        <FormField
          id="cl-prizes"
          label="Prizes (JSON)"
          error={errors.prizesJson?.message}
          hint='Ej: { "1": { "kind": "chips", "amount": "1000" }, "2-5": { "kind": "bonus", ... } }'
        >
          <textarea
            id="cl-prizes"
            rows={5}
            aria-invalid={!!errors.prizesJson}
            placeholder={
              '{\n  "1": { "kind": "chips", "amount": "1000" },\n  "2-5": { "kind": "chips", "amount": "500" }\n}'
            }
            className={textareaClass(!!errors.prizesJson)}
            {...register('prizesJson')}
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
  if (err.status === 409) return 'Ya existe una liga con ese código.';
  if (err.status === 403) return 'No tenés permiso para crear leagues.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}
