'use client';

/**
 * RegisterModal — player registration as a modal overlay.
 * Glass card style. Supports ?ref for referral attribution.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldAlert, UserPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TangoWordmark } from '@/components/brand/tango-wordmark';
import { useAuth } from '@/lib/auth-context';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';

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
      errorMap: () => ({ message: 'Debés confirmar que sos mayor de 18 años.' }),
    }),
    consentDataProcessing: z.literal(true, {
      errorMap: () => ({ message: 'Debés aceptar el tratamiento de datos personales.' }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

interface RegisterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refCode?: string;
  next?: string;
  onSwitchToLogin: () => void;
}

export function RegisterModal({ open, onOpenChange, refCode, next, onSwitchToLogin }: RegisterModalProps) {
  const { setTokens } = useAuth();
  const tenantInfo = useTenantInfo();
  const branding = tenantInfo.data?.branding;
  const designBrand = tenantInfo.data?.design?.brand as { logoUrl?: string } | undefined;
  const logoUrl = branding?.logoUrl || designBrand?.logoUrl;
  const [serverError, setServerError] = useState<string | null>(null);
  const [refValid, setRefValid] = useState<boolean | null>(
    refCode ? null : true,
  );

  // Validate referral code on mount / when refCode changes
  useEffect(() => {
    if (!refCode || !open) {
      if (!refCode) setRefValid(true);
      return;
    }
    setRefValid(null);
    let cancelled = false;
    apiGet<{ valid: boolean }>(
      `/tenant/referrals/resolve/${encodeURIComponent(refCode)}`,
    )
      .then((data) => {
        if (!cancelled) setRefValid(data.valid);
      })
      .catch(() => {
        if (!cancelled) setRefValid(true); // invalid code → proceed without attribution
      });
    return () => { cancelled = true; };
  }, [refCode, open]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
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
      // Register endpoint returns JWT directly (auto-login built-in).
      const result = await apiPost<{ accessToken: string; refreshToken: string }>(
        '/tenant/auth/register',
        {
          username: values.username,
          password: values.password,
          displayName: values.displayName,
          email: values.email || undefined,
          phone: values.phone || undefined,
          ref: refCode || undefined,
          ageConfirmation: true,
          consentDataProcessing: true,
        },
      );

      // Use the tokens from the register response (don't call /login again).
      await setTokens(result.accessToken, result.refreshToken);
      reset();
      onOpenChange(false);
      if (next) window.location.href = next;
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
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[3px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md surface-glass rounded-[var(--radius-xl)] p-8 flex items-center justify-center min-h-[400px] focus:outline-none">
            <span className="size-6 border-2 border-current border-r-transparent animate-spin rounded-full text-[var(--color-fg-muted)]" />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) { setServerError(null); reset(); } onOpenChange(v); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[70] -translate-x-1/2 -translate-y-1/2',
            'w-[calc(100%-2rem)] max-w-md',
            'surface-glass rounded-[var(--radius-xl)] p-8 flex flex-col gap-7',
            'focus:outline-none max-h-[90vh] overflow-y-auto',
            'data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=open]:duration-200',
          )}
        >
          {/* Background atmosphere */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-40 rounded-[var(--radius-xl)] overflow-hidden pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(ellipse 80% 60% at 50% 0%, var(--color-accent-glow) 0%, transparent 60%)`,
            }}
          />

          {/* Close button */}
          <Dialog.Close className="absolute right-4 top-4 z-10 size-7 flex items-center justify-center text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] rounded transition-colors" aria-label="Cerrar">
            <X className="size-4" />
          </Dialog.Close>

          {/* Brand + header */}
          <div className="relative z-10 flex flex-col items-center gap-4 text-center">
            <TangoWordmark size="lg" src={logoUrl} />
            <div className="flex flex-col gap-1">
              <Dialog.Title className="font-display text-[2.25rem] leading-none tracking-tight">
                Creá tu cuenta
              </Dialog.Title>
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
            <div role="alert" className="relative z-10 flex items-start gap-3 px-3 py-2.5 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)]">
              <ShieldAlert className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">No pudimos registrarte</span>
                <span className="text-[12px] text-[var(--color-fg)]">{serverError}</span>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="relative z-10 flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reg-username">Usuario</Label>
              <Input id="reg-username" type="text" autoComplete="username" autoFocus invalid={!!errors.username} className="h-10" placeholder="Ej: carlos_123" {...register('username')} />
              {errors.username && <span className="text-xs text-[var(--color-accent-text)]">{errors.username.message}</span>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reg-displayName">Nombre</Label>
              <Input id="reg-displayName" type="text" autoComplete="name" invalid={!!errors.displayName} className="h-10" placeholder="Tu nombre para mostrar" {...register('displayName')} />
              {errors.displayName && <span className="text-xs text-[var(--color-accent-text)]">{errors.displayName.message}</span>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reg-password">Contraseña</Label>
              <Input id="reg-password" type="password" autoComplete="new-password" invalid={!!errors.password} className="h-10" {...register('password')} />
              {errors.password && <span className="text-xs text-[var(--color-accent-text)]">{errors.password.message}</span>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reg-confirmPassword">Confirmar contraseña</Label>
              <Input id="reg-confirmPassword" type="password" autoComplete="new-password" invalid={!!errors.confirmPassword} className="h-10" {...register('confirmPassword')} />
              {errors.confirmPassword && <span className="text-xs text-[var(--color-accent-text)]">{errors.confirmPassword.message}</span>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reg-email">Email <span className="text-[var(--color-fg-subtle)]">(opcional)</span></Label>
              <Input id="reg-email" type="email" autoComplete="email" invalid={!!errors.email} className="h-10" {...register('email')} />
              {errors.email && <span className="text-xs text-[var(--color-accent-text)]">{errors.email.message}</span>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reg-phone">Teléfono <span className="text-[var(--color-fg-subtle)]">(opcional)</span></Label>
              <Input id="reg-phone" type="tel" autoComplete="tel" invalid={!!errors.phone} className="h-10" {...register('phone')} />
            </div>

            {/* Age confirmation */}
            <div className="flex items-start gap-3">
              <input id="reg-ageConfirmation" type="checkbox" className="mt-1 size-4 shrink-0 rounded border-[var(--color-border)] accent-[var(--color-accent)]" {...register('ageConfirmation')} />
              <Label htmlFor="reg-ageConfirmation" className="text-[13px] leading-snug cursor-pointer">Confirmo que soy mayor de 18 años</Label>
            </div>
            {errors.ageConfirmation && <span className="text-xs text-[var(--color-accent-text)] -mt-2">{errors.ageConfirmation.message}</span>}

            {/* Consent */}
            <div className="flex items-start gap-3">
              <input id="reg-consentDataProcessing" type="checkbox" className="mt-1 size-4 shrink-0 rounded border-[var(--color-border)] accent-[var(--color-accent)]" {...register('consentDataProcessing')} />
              <Label htmlFor="reg-consentDataProcessing" className="text-[13px] leading-snug cursor-pointer">Acepto el tratamiento de mis datos personales según la política de privacidad</Label>
            </div>
            {errors.consentDataProcessing && <span className="text-xs text-[var(--color-accent-text)] -mt-2">{errors.consentDataProcessing.message}</span>}

            <Button type="submit" size="lg" disabled={isSubmitting} className="mt-2 w-full">
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
          <div className="relative z-10 flex items-center justify-between text-[10px] text-[var(--color-fg-subtle)] pt-5 border-t border-[var(--color-border)]">
            <span className="uppercase tracking-[0.12em]">Juego responsable · +18</span>
            <button
              type="button"
              onClick={() => { reset(); setServerError(null); onSwitchToLogin(); }}
              className="hover:text-[var(--color-fg-muted)] transition-colors uppercase tracking-[0.12em]"
            >
              ¿Ya tenés cuenta? Ingresá
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
