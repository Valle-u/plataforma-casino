'use client';

/**
 * LoginModal — player login as a modal overlay (not a separate page).
 * Glass card style matching the previous /play/login page.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandWordmark } from '@/components/brand/brand-wordmark';
import { TurnstileWidget } from '@/components/ui/turnstile-widget';
import {
  getLoginErrorInfo,
  useAuth,
  type LoginErrorInfo,
} from '@/lib/auth-context';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { TURNSTILE_ENABLED } from '@/lib/turnstile';
import { cn } from '@/lib/cn';

const schema = z.object({
  username: z.string().min(1, { message: 'Ingresá tu usuario.' }),
  password: z.string().min(1, { message: 'Ingresá tu contraseña.' }),
});

type FormValues = z.infer<typeof schema>;

interface LoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  next?: string;
  onSwitchToRegister: () => void;
}

export function LoginModal({ open, onOpenChange, next, onSwitchToRegister }: LoginModalProps) {
  const { login } = useAuth();
  const tenantInfo = useTenantInfo();
  const branding = tenantInfo.data?.branding;
  const designBrand = tenantInfo.data?.design?.brand as { logoUrl?: string } | undefined;
  const logoUrl = branding?.logoUrl || designBrand?.logoUrl;
  const [loginError, setLoginError] = useState<LoginErrorInfo | null>(null);
  // Turnstile: token vigente + key para remontar el widget y pedir uno nuevo
  // tras cada intento (los tokens son de un solo uso).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setLoginError(null);
    try {
      await login(
        values.username,
        values.password,
        'player',
        captchaToken ?? undefined,
      );
      reset();
      onOpenChange(false);
      if (next) window.location.href = next;
    } catch (err) {
      setLoginError(getLoginErrorInfo(err));
      // Token consumido: pedimos uno nuevo para el próximo intento.
      setCaptchaToken(null);
      setCaptchaKey((k) => k + 1);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) { setLoginError(null); reset(); } onOpenChange(v); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[70] -translate-x-1/2 -translate-y-1/2',
            'w-[calc(100%-2rem)] max-w-md',
            'surface-glass rounded-[var(--radius-xl)] p-8 flex flex-col gap-7',
            'focus:outline-none',
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
            <BrandWordmark size="lg" src={logoUrl} />
            <div className="flex flex-col gap-1">
              <Dialog.Title className="font-display text-[2.25rem] leading-none tracking-tight">
                Bienvenido
              </Dialog.Title>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent-text)]">
                {branding?.tagline || 'Tu reino · Tus reglas · Tu juego'}
              </p>
              <p className="text-[13px] text-[var(--color-fg-muted)]">
                Ingresá con tu cuenta de jugador para empezar.
              </p>
            </div>
          </div>

          {/* Cartel de error: título de la situación + explicación. Para
              problemas de estado de cuenta (bloqueada/suspendida/inactiva/
              pendiente) es más prominente y deja claro que hay que ir a soporte. */}
          {loginError && (
            <div
              role="alert"
              className={cn(
                'relative z-10 flex items-start gap-3 px-3.5 py-3 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)]',
                loginError.isAccountStatus && 'py-3.5',
              )}
            >
              <ShieldAlert className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
              <div className="flex flex-col gap-1">
                <span className="text-[12px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-semibold">
                  {loginError.title}
                </span>
                <span className="text-[13px] text-[var(--color-fg)] leading-snug">
                  {loginError.message}
                </span>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="relative z-10 flex flex-col gap-5" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="login-username">Usuario</Label>
              <Input id="login-username" type="text" autoComplete="username" autoFocus invalid={!!errors.username} className="h-10" {...register('username')} />
              {errors.username && <span className="text-xs text-[var(--color-accent-text)]">{errors.username.message}</span>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="login-password">Contraseña</Label>
              <Input id="login-password" type="password" autoComplete="current-password" invalid={!!errors.password} className="h-10" {...register('password')} />
              {errors.password && <span className="text-xs text-[var(--color-accent-text)]">{errors.password.message}</span>}
            </div>
            {TURNSTILE_ENABLED && (
              <TurnstileWidget
                key={captchaKey}
                onToken={setCaptchaToken}
                action="login"
                className="flex justify-center"
              />
            )}
            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting || (TURNSTILE_ENABLED && !captchaToken)}
              className="mt-2 w-full"
            >
              {isSubmitting ? (
                <>
                  <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                  Ingresando…
                </>
              ) : (
                <>
                  Entrar
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </form>

          {/* Footer */}
          <div className="relative z-10 flex items-center justify-between text-[10px] text-[var(--color-fg-subtle)] pt-5 border-t border-[var(--color-border)]">
            <span className="uppercase tracking-[0.12em]">Juego responsable · +18</span>
            <button
              type="button"
              onClick={() => { reset(); setLoginError(null); onSwitchToRegister(); }}
              className="hover:text-[var(--color-fg-muted)] transition-colors uppercase tracking-[0.12em]"
            >
              Registrate
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
