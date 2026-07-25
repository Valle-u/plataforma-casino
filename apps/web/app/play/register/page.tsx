/**
 * /play/register — Registro público de jugadores vía referral link.
 *
 * Flujo:
 *   1. Si ?ref=X en URL → llama GET /tenant/referrals/resolve/X para validar.
 *   2. Si código válido → formulario (sin mostrar quién refirió).
 *   3. Submit → POST /tenant/auth/register → login automático → /play.
 *
 * Seguridad (docs/12):
 *   - Age checkbox obligatorio (§6.1).
 *   - Consent checkbox obligatorio (§16.1 — Ley 25.326).
 *   - Rate limit en backend: 5 / 15 min por IP.
 *
 * Diseño: misma vibe consumer que /play/login (glass card, radial glow).
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldAlert, UserPlus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TangoWordmark } from '@/components/brand/tango-wordmark';
import { useAuth } from '@/lib/auth-context';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';

const schema = z
  .object({
    username: z
      .string()
      .min(3, { message: 'El usuario debe tener al menos 3 caracteres.' })
      .max(30)
      .regex(/^[a-zA-Z0-9_-]+$/, {
        message: 'Solo letras, números, guiones y guiones bajos.',
      }),
    displayName: z
      .string()
      .min(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
      .max(50),
    password: z
      .string()
      .min(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
      .max(100),
    confirmPassword: z.string(),
    email: z
      .string()
      .email({ message: 'El email no es válido.' })
      .optional()
      .or(z.literal('')),
    phone: z.string().max(30).optional().or(z.literal('')),
    ageConfirmation: z.literal(true, {
      errorMap: () => ({
        message: 'Debés confirmar que sos mayor de 18 años.',
      }),
    }),
    consentDataProcessing: z.literal(true, {
      errorMap: () => ({
        message: 'Debés aceptar el tratamiento de datos personales.',
      }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

function RegisterPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const refCode = searchParams.get('ref');
  const { user, login } = useAuth();
  const tenantInfo = useTenantInfo();
  const branding = tenantInfo.data?.branding;
  const designBrand = tenantInfo.data?.design?.brand as
    | { logoUrl?: string }
    | undefined;
  const logoUrl = branding?.logoUrl || designBrand?.logoUrl;
  const [serverError, setServerError] = useState<string | null>(null);
  const [refValid, setRefValid] = useState<boolean | null>(
    refCode ? null : true,
  );

  // Si ya hay sesión activa, redirigir al play.
  useEffect(() => {
    if (user) router.replace('/play');
  }, [user, router]);

  // Validar código de referido al montar.
  useEffect(() => {
    if (!refCode) {
      setRefValid(true);
      return;
    }
    let cancelled = false;
    apiGet<{ valid: boolean }>(
      `/tenant/referrals/resolve/${encodeURIComponent(refCode)}`,
    )
      .then((data) => {
        if (!cancelled) setRefValid(data.valid);
      })
      .catch(() => {
        if (!cancelled) setRefValid(true); // código inválido → sigue sin atribución
      });
    return () => {
      cancelled = true;
    };
  }, [refCode]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: '',
      displayName: '',
      password: '',
      confirmPassword: '',
      email: '',
      phone: '',
    },
  });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      await apiPost('/tenant/auth/register', {
        username: values.username,
        password: values.password,
        displayName: values.displayName,
        email: values.email || undefined,
        phone: values.phone || undefined,
        ref: refCode || undefined,
        ageConfirmation: true,
        consentDataProcessing: true,
      });

      // Login automático post-registro.
      await login(values.username, values.password, 'player');
      router.replace('/play');
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
      } else {
        setServerError('Error de conexión. Verificá tu red.');
      }
    }
  };

  // Loading state while validating ref code.
  if (refCode && refValid === null) {
    return (
      <div className="relative min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
        <span className="size-6 border-2 border-current border-r-transparent animate-spin rounded-full text-[var(--color-fg-muted)]" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-6 overflow-hidden bg-[var(--color-bg)]">
      {/* Background atmosphere — radial glow + grid */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage: `radial-gradient(
            ellipse 80% 60% at 50% 0%,
            var(--color-accent-glow) 0%,
            transparent 60%
          )`,
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `
            linear-gradient(to right, var(--color-fg) 1px, transparent 1px),
            linear-gradient(to bottom, var(--color-fg) 1px, transparent 1px)
          `,
          backgroundSize: '32px 32px',
        }}
      />

      {/* Card */}
      <div className="relative z-10 w-full max-w-md animate-fade-up">
        <div className="surface-glass rounded-[var(--radius-xl)] p-8 flex flex-col gap-7">
          {/* Brand + header */}
          <div className="flex flex-col items-center gap-4 text-center">
            <TangoWordmark size="lg" src={logoUrl} />
            <div className="flex flex-col gap-1">
              <h1 className="font-display text-[2.25rem] leading-none tracking-tight">
                Creá tu cuenta
              </h1>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent-text)]">
                Tu reino · Tus reglas · Tu juego
              </p>
              <p className="text-[13px] text-[var(--color-fg-muted)]">
                Completá los datos para empezar a jugar.
              </p>
            </div>
          </div>

          {/* Server error */}
          {serverError && (
            <div
              role="alert"
              className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)]"
            >
              <ShieldAlert className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
                  No pudimos registrarte
                </span>
                <span className="text-[12px] text-[var(--color-fg)]">
                  {serverError}
                </span>
              </div>
            </div>
          )}

          {/* Form */}
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            {/* Username */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">Usuario</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                invalid={!!errors.username}
                className="h-10"
                placeholder="Ej: carlos_123"
                {...register('username')}
              />
              {errors.username && (
                <span className="text-xs text-[var(--color-accent-text)]">
                  {errors.username.message}
                </span>
              )}
            </div>

            {/* Display name */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="displayName">Nombre</Label>
              <Input
                id="displayName"
                type="text"
                autoComplete="name"
                invalid={!!errors.displayName}
                className="h-10"
                placeholder="Tu nombre para mostrar"
                {...register('displayName')}
              />
              {errors.displayName && (
                <span className="text-xs text-[var(--color-accent-text)]">
                  {errors.displayName.message}
                </span>
              )}
            </div>

            {/* Password */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                invalid={!!errors.password}
                className="h-10"
                {...register('password')}
              />
              {errors.password && (
                <span className="text-xs text-[var(--color-accent-text)]">
                  {errors.password.message}
                </span>
              )}
            </div>

            {/* Confirm password */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                invalid={!!errors.confirmPassword}
                className="h-10"
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && (
                <span className="text-xs text-[var(--color-accent-text)]">
                  {errors.confirmPassword.message}
                </span>
              )}
            </div>

            {/* Email (optional) */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">
                Email <span className="text-[var(--color-fg-subtle)]">(opcional)</span>
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                invalid={!!errors.email}
                className="h-10"
                {...register('email')}
              />
              {errors.email && (
                <span className="text-xs text-[var(--color-accent-text)]">
                  {errors.email.message}
                </span>
              )}
            </div>

            {/* Phone (optional) */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">
                Teléfono <span className="text-[var(--color-fg-subtle)]">(opcional)</span>
              </Label>
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                invalid={!!errors.phone}
                className="h-10"
                {...register('phone')}
              />
            </div>

            {/* Age confirmation (docs/12 §6.1) */}
            <div className="flex items-start gap-3">
              <input
                id="ageConfirmation"
                type="checkbox"
                className="mt-1 size-4 shrink-0 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
                {...register('ageConfirmation')}
              />
              <Label htmlFor="ageConfirmation" className="text-[13px] leading-snug cursor-pointer">
                Confirmo que soy mayor de 18 años
              </Label>
            </div>
            {errors.ageConfirmation && (
              <span className="text-xs text-[var(--color-accent-text)] -mt-2">
                {errors.ageConfirmation.message}
              </span>
            )}

            {/* Consent (docs/12 §16.1 — Ley 25.326) */}
            <div className="flex items-start gap-3">
              <input
                id="consentDataProcessing"
                type="checkbox"
                className="mt-1 size-4 shrink-0 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
                {...register('consentDataProcessing')}
              />
              <Label htmlFor="consentDataProcessing" className="text-[13px] leading-snug cursor-pointer">
                Acepto el tratamiento de mis datos personales según la política de privacidad
              </Label>
            </div>
            {errors.consentDataProcessing && (
              <span className="text-xs text-[var(--color-accent-text)] -mt-2">
                {errors.consentDataProcessing.message}
              </span>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting}
              className="mt-2 w-full"
            >
              {isSubmitting ? (
                <>
                  <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                  Registrando…
                </>
              ) : (
                <>
                  Crear cuenta
                  <UserPlus className="size-4" />
                </>
              )}
            </Button>
          </form>

          {/* Footer */}
          <div className="flex items-center justify-between text-[10px] text-[var(--color-fg-subtle)] pt-5 border-t border-[var(--color-border)]">
            <span className="uppercase tracking-[0.12em]">Juego responsable · +18</span>
            <a
              href="/play/login"
              className="hover:text-[var(--color-fg-muted)] transition-colors uppercase tracking-[0.12em]"
            >
              ¿Ya tenés cuenta? Ingresá
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="relative min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
          <span className="size-6 border-2 border-current border-r-transparent animate-spin rounded-full text-[var(--color-fg-muted)]" />
        </div>
      }
    >
      <RegisterPageInner />
    </Suspense>
  );
}
