'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
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
  useCreateNodePaymentMethod,
  type PaymentMethodType,
} from '@/lib/hooks/use-payment-methods';
import { cn } from '@/lib/cn';

const TYPES: { value: PaymentMethodType; label: string; hint: string }[] = [
  { value: 'bank_transfer', label: 'Transferencia bancaria', hint: 'CBU/CVU + alias + titular.' },
  { value: 'crypto', label: 'Cripto', hint: 'Network + address (TRC20, BEP20, etc.).' },
  { value: 'other', label: 'Otro', hint: 'Config JSON libre.' },
];

const codeRegex = /^[a-z0-9][a-z0-9_-]{1,49}$/;

const schema = z.object({
  code: z.string().min(2, 'Mínimo 2.').max(50, 'Máximo 50.').regex(codeRegex, 'lowercase + dígitos + _- (empezar con letra/dígito).'),
  name: z.string().min(3, 'Mínimo 3.').max(120, 'Máximo 120.'),
  type: z.enum(['bank_transfer', 'crypto', 'other']),
  chipsPerUnit: z.coerce.number({ invalid_type_error: 'Ingresá un número.' }).min(0.0001, 'Mayor a 0.').max(1_000_000, 'Demasiado alto.'),
  isActive: z.boolean(),
  cbu: z.string().max(60).optional().or(z.literal('')),
  alias: z.string().max(60).optional().or(z.literal('')),
  beneficiario: z.string().max(120).optional().or(z.literal('')),
  banco: z.string().max(120).optional().or(z.literal('')),
  network: z.string().max(40).optional().or(z.literal('')),
  address: z.string().max(200).optional().or(z.literal('')),
  memo: z.string().max(200).optional().or(z.literal('')),
  configJson: z.string().optional().or(z.literal('')).refine((v) => !v || isValidJson(v), { message: 'JSON inválido.' }),
}).refine(
  // Para transferencia bancaria hace falta CBU/CVU o alias: sin eso el método
  // queda sin cuenta (config vacío) y el socio queda bloqueado de operar
  // transferencias sin darse cuenta (el toast decía "creado" igual).
  (v) => v.type !== 'bank_transfer' || !!(v.cbu?.trim() || v.alias?.trim()),
  { message: 'Cargá el CBU/CVU o el alias.', path: ['cbu'] },
);

type FormValues = z.infer<typeof schema>;

function isValidJson(v: string): boolean {
  try { JSON.parse(v); return true; } catch { return false; }
}

function buildConfig(values: FormValues): Record<string, unknown> {
  if (values.type === 'bank_transfer') {
    const cfg: Record<string, unknown> = {};
    if (values.cbu) cfg.cbu = values.cbu;
    if (values.alias) cfg.alias = values.alias;
    if (values.beneficiario) cfg.beneficiario = values.beneficiario;
    if (values.banco) cfg.banco = values.banco;
    return cfg;
  }
  if (values.type === 'crypto') {
    const cfg: Record<string, unknown> = {};
    if (values.network) cfg.network = values.network;
    if (values.address) cfg.address = values.address;
    if (values.memo) cfg.memo = values.memo;
    return cfg;
  }
  if (values.configJson && values.configJson.trim() !== '') {
    try {
      const parsed = JSON.parse(values.configJson);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* zod ya validó */ }
  }
  return {};
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateNodePaymentMethodModal({ open, onOpenChange }: Props) {
  const create = useCreateNodePaymentMethod();
  const [serverError, setServerError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors }, reset, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: '', name: '', type: 'bank_transfer', chipsPerUnit: 1, isActive: true,
      cbu: '', alias: '', beneficiario: '', banco: '',
      network: 'TRC20', address: '', memo: '', configJson: '',
    },
  });

  useEffect(() => {
    if (!open) { reset(); setServerError(null); }
  }, [open, reset]);

  const selectedType = watch('type');
  const typeHint = TYPES.find((t) => t.value === selectedType)?.hint;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const created = await create.mutateAsync({
        code: values.code,
        name: values.name,
        type: values.type,
        config: buildConfig(values),
        chipsPerUnit: values.chipsPerUnit,
        isActive: values.isActive,
      });
      toast.success('Método creado', { description: `${created.code} · ${created.type}` });
      onOpenChange(false);
    } catch (err) {
      const msg = mapError(err);
      setServerError(msg);
      toast.error('No se pudo crear', { description: msg });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Crear método de pago"
      description="Tus jugadores lo verán al depositar."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="md" type="button" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" size="md" type="submit" form="create-node-pm-form" disabled={create.isPending}>
            {create.isPending ? (
              <><span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" /> Creando…</>
            ) : (
              <><Plus className="size-3.5" /> Crear</>
            )}
          </Button>
        </>
      }
    >
      <form id="create-node-pm-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {serverError && (
          <div className="px-3 py-2 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)] text-[12px] text-[var(--color-fg)]">
            {serverError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField id="npm-code" label="Código" required error={errors.code?.message} hint="lowercase + [a-z0-9_-]. Único por sucursal.">
            <Input id="npm-code" type="text" placeholder="mi_banco" className="font-mono" invalid={!!errors.code} {...register('code')} />
          </FormField>
          <FormField id="npm-name" label="Nombre visible" required error={errors.name?.message} hint="El jugador lo ve en el dropdown.">
            <Input id="npm-name" type="text" placeholder="Mi Cuenta" invalid={!!errors.name} {...register('name')} />
          </FormField>
        </div>

        <FormField id="npm-type" label="Tipo" required error={errors.type?.message} hint={typeHint}>
          <Select id="npm-type" invalid={!!errors.type} {...register('type')}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </FormField>

        <FormField id="npm-ratio" label="Fichas por unidad" required error={errors.chipsPerUnit?.message} hint="Cuántas fichas vale 1 unidad. Ej: pesos → 1; USDT → 1000.">
          <Input id="npm-ratio" type="number" step="0.0001" min="0.0001" inputMode="decimal" placeholder="1" className="font-mono" invalid={!!errors.chipsPerUnit} {...register('chipsPerUnit')} />
        </FormField>

        {selectedType === 'bank_transfer' && (
          <div className="flex flex-col gap-3 p-3 border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">Datos bancarios</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField id="npm-cbu" label="CBU / CVU"><Input id="npm-cbu" type="text" inputMode="numeric" placeholder="0000003100000000000000" className="font-mono" {...register('cbu')} /></FormField>
              <FormField id="npm-alias" label="Alias"><Input id="npm-alias" type="text" placeholder="mi.alias" {...register('alias')} /></FormField>
              <FormField id="npm-beneficiario" label="Titular"><Input id="npm-beneficiario" type="text" placeholder="Tu Nombre" {...register('beneficiario')} /></FormField>
              <FormField id="npm-banco" label="Banco"><Input id="npm-banco" type="text" placeholder="Mi Banco" {...register('banco')} /></FormField>
            </div>
          </div>
        )}

        {selectedType === 'crypto' && (
          <div className="flex flex-col gap-3 p-3 border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">Wallet de recepción</span>
            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
              <FormField id="npm-network" label="Network"><Input id="npm-network" type="text" placeholder="TRC20" className="font-mono" {...register('network')} /></FormField>
              <FormField id="npm-address" label="Address"><Input id="npm-address" type="text" placeholder="T..." className="font-mono" {...register('address')} /></FormField>
            </div>
            <FormField id="npm-memo" label="Memo / Tag" hint="Opcional.">
              <Input id="npm-memo" type="text" placeholder="" {...register('memo')} />
            </FormField>
          </div>
        )}

        {selectedType === 'other' && (
          <FormField id="npm-config" label="Config (JSON)" error={errors.configJson?.message} hint="Shape libre.">
            <textarea id="npm-config" rows={4} aria-invalid={!!errors.configJson} placeholder='{"instrucciones": "Contactar al operador"}' className={textareaClass(!!errors.configJson)} {...register('configJson')} />
          </FormField>
        )}

        <label className="flex items-center gap-2 text-[12px] text-[var(--color-fg)] cursor-pointer select-none">
          <input type="checkbox" {...register('isActive')} className="size-4 accent-[var(--color-accent)] cursor-pointer" />
          Activo desde el inicio
        </label>
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
    if (err.code === 'PAYMENT_METHOD_CODE_CONFLICT') return 'Ya existe un método con ese código.';
    return err.message || 'Conflicto.';
  }
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}
