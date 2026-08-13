'use client';

/**
 * Tab "Perfil" de /play/account (docs/21-plan-perfil-wallet.md).
 *
 * Hero (avatar, nombre, VIP, saldo) + formulario editable (nombre, apellido,
 * teléfono, email, idioma) + notificaciones push. El @usuario queda fijo.
 *
 * Guarda vía `PATCH /tenant/auth/me` (backend nuevo de la Parte A) y refresca
 * el user del context con `refreshMe()` (displayName se deriva server-side).
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { Check } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { apiPatch, isApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { useVipTier } from '@/lib/hooks/use-vip-tier';

const profileSchema = z.object({
  firstName: z.string().trim().max(100, 'Máximo 100 caracteres.'),
  lastName: z.string().trim().max(100, 'Máximo 100 caracteres.'),
  phone: z
    .string()
    .max(30, 'Máximo 30 caracteres.')
    .regex(/^[0-9+()\-\s]*$/, 'Solo números, espacios y + - ( ).'),
  email: z.string().trim().email('Email inválido.').max(255).or(z.literal('')),
  language: z.literal('es'),
});

type ProfileValues = z.infer<typeof profileSchema>;

const arsFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2)
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

export function PerfilTab() {
  const { user, refreshMe } = useAuth();
  const wallet = useMyWallet();
  const vip = useVipTier();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    mode: 'onChange',
    defaultValues: {
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      phone: user?.phone ?? '',
      email: user?.email ?? '',
      language: 'es',
    },
  });

  // Sincroniza el form cuando el user llega / se refresca (tras guardar).
  useEffect(() => {
    if (!user) return;
    reset({
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      phone: user.phone ?? '',
      email: user.email ?? '',
      language: 'es',
    });
  }, [user, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const payload: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      email?: string;
    } = {};
    if (values.firstName) payload.firstName = values.firstName;
    if (values.lastName) payload.lastName = values.lastName;
    if (values.phone) payload.phone = values.phone;
    if (values.email) payload.email = values.email;

    try {
      await apiPatch('/tenant/auth/me', payload);
      await refreshMe();
      toast.success('Perfil actualizado', {
        description: 'Tus datos se guardaron correctamente.',
      });
    } catch (err) {
      toast.error('No se pudo guardar el perfil', {
        description: isApiError(err)
          ? err.message
          : 'Ocurrió un error inesperado. Intentá de nuevo.',
      });
    }
  });

  const name = user?.displayName || user?.username || 'Jugador';
  const initials = initialsFrom(name);
  const TierIcon = vip.tier.icon;
  const saldo =
    wallet.data?.balance != null
      ? `$ ${arsFmt.format(Number(wallet.data.balance))}`
      : '—';
  const twoFa = user?.twoFaEnabled;

  return (
    <div className="flex flex-col gap-4">
      {/* Hero */}
      <section
        className="flex flex-col items-center gap-5 rounded-[var(--radius-xl)] border border-[var(--color-border)] p-6 sm:flex-row"
        style={{
          backgroundImage:
            'radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, var(--color-purple) 18%, transparent) 0%, transparent 55%), var(--color-bg-elevated)',
        }}
      >
        <div
          className="grid size-20 shrink-0 place-items-center rounded-[var(--radius-lg)] font-display text-[28px] text-white"
          style={{
            background: 'linear-gradient(135deg, #7b2ff7, #ff3ec9)',
            boxShadow: '0 0 28px -6px rgba(123,47,247,.6)',
          }}
        >
          {initials}
        </div>

        <div className="flex flex-1 flex-col items-center gap-2 text-center sm:items-start sm:text-left">
          <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            <h2 className="font-display text-[24px] leading-none">{name}</h2>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#1a1206]"
              style={{ background: vip.tier.gradient }}
            >
              <TierIcon className="size-3" />
              VIP {vip.tier.label}
            </span>
          </div>
          <span className="text-[12px] text-[var(--color-fg-muted)]">
            @{user?.username ?? '—'}
          </span>
          <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
            <HeroStat label="Saldo" value={saldo} color="var(--color-fg)" />
            <HeroStat
              label="Nivel VIP"
              value={vip.tier.label}
              color="var(--color-gold)"
            />
            <HeroStat
              label="Volumen apostado"
              value={`${Number(vip.volume).toLocaleString('es-AR')} fichas`}
              color="var(--color-accent-text)"
            />
          </div>
        </div>

        <span
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em]"
          style={{
            color: 'var(--color-success)',
            background: 'color-mix(in srgb, var(--color-success) 14%, transparent)',
          }}
        >
          <Check className="size-3" />
          {twoFa ? 'Verificado' : 'Cuenta activa'}
        </span>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Datos editables */}
        <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
          <h3 className="mb-1 font-display text-[18px]">Datos personales</h3>
          <p className="mb-4 text-[11px] text-[var(--color-fg-subtle)]">
            Estos datos se muestran a soporte y se usan para contactarte. El{' '}
            <span className="text-[var(--color-fg-muted)]">@usuario</span> no se
            puede cambiar.
          </p>

          <form id="perfil-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                id="perfil-first-name"
                label="Nombre"
                error={errors.firstName?.message}
              >
                <Input
                  id="perfil-first-name"
                  autoComplete="given-name"
                  placeholder="Tu nombre"
                  invalid={!!errors.firstName}
                  {...register('firstName')}
                />
              </FormField>
              <FormField
                id="perfil-last-name"
                label="Apellido"
                error={errors.lastName?.message}
              >
                <Input
                  id="perfil-last-name"
                  autoComplete="family-name"
                  placeholder="Tu apellido"
                  invalid={!!errors.lastName}
                  {...register('lastName')}
                />
              </FormField>
            </div>

            <FormField id="perfil-username" label="Usuario">
              <Input
                id="perfil-username"
                value={`@${user?.username ?? ''}`}
                disabled
                aria-disabled="true"
              />
            </FormField>

            <FormField
              id="perfil-phone"
              label="Teléfono"
              hint="Con código de país, ej. +54 9 11 5555-5555."
              error={errors.phone?.message}
            >
              <Input
                id="perfil-phone"
                autoComplete="tel"
                placeholder="+54 9 11 …"
                invalid={!!errors.phone}
                {...register('phone')}
              />
            </FormField>

            <FormField
              id="perfil-email"
              label="Email"
              hint="Lo usamos para avisos y recuperación."
              error={errors.email?.message}
            >
              <Input
                id="perfil-email"
                type="email"
                autoComplete="email"
                placeholder="vos@email.com"
                invalid={!!errors.email}
                {...register('email')}
              />
            </FormField>

            <FormField
              id="perfil-language"
              label="Idioma"
              hint="Por ahora solo español está disponible."
            >
              <Select id="perfil-language" {...register('language')}>
                <option value="es">Español</option>
              </Select>
            </FormField>

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </div>
          </form>
        </section>

      </div>
    </div>
  );
}

function HeroStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-medium uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span className="text-[15px] font-semibold tabular-nums" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
