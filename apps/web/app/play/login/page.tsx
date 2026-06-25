/**
 * /play/login — login del jugador.
 *
 * Diferencias con /login (admin):
 *   - Vibe consumer (no terminal): card centrada, hero más grande,
 *     animación de entrada, sin "Operación controlada" tagline.
 *   - Mensajes en tono jugador ("¡Bienvenido!" en lugar de "Acceso restringido").
 *   - Mismo backend endpoint (`/tenant/auth/login`) — comparte sesión con
 *     el admin (mismo token), pero post-login redirige a `/play` no a
 *     `/dashboard`.
 *
 * El layout `play` NO se aplica acá (no hay user logueado todavía) —
 * esta página tiene su propio layout simple (root layout solo).
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TangoWordmark } from '@/components/brand/tango-wordmark';
import { getLoginErrorMessage, useAuth } from '@/lib/auth-context';

const schema = z.object({
  username: z.string().min(1, { message: 'Ingresá tu usuario.' }),
  password: z.string().min(1, { message: 'Ingresá tu contraseña.' }),
});

type FormValues = z.infer<typeof schema>;

export default function PlayLoginPage() {
  const router = useRouter();
  const { user, login } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  // Si ya hay sesión activa, redirigir al dashboard del jugador.
  useEffect(() => {
    if (user) router.replace('/play');
  }, [user, router]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      // Sprint 43 (security): audience='player' no filtra por rol — un
      // admin puede loguearse acá para "ver lo que ve el jugador" (el
      // comment del PlayerLayout lo documenta como diseño).
      await login(values.username, values.password, 'player');
      router.replace('/play');
    } catch (err) {
      setServerError(getLoginErrorMessage(err));
    }
  };

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
          {/* Brand + welcome */}
          <div className="flex flex-col items-center gap-4 text-center">
            <TangoWordmark size="lg" />
            <div className="flex flex-col gap-1">
              <h1 className="font-display text-[2.25rem] leading-none tracking-tight">
                Bienvenido
              </h1>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent-text)]">
                Tu reino · Tus reglas · Tu juego
              </p>
              <p className="text-[13px] text-[var(--color-fg-muted)]">
                Ingresá con tu cuenta de jugador para empezar.
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
                  No pudimos ingresarte
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
            className="flex flex-col gap-5"
            noValidate
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">Usuario</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                invalid={!!errors.username}
                className="h-10"
                {...register('username')}
              />
              {errors.username && (
                <span className="text-xs text-[var(--color-accent-text)]">
                  {errors.username.message}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
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

            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting}
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
          <div className="flex items-center justify-between text-[10px] text-[var(--color-fg-subtle)] pt-5 border-t border-[var(--color-border)]">
            <span className="uppercase tracking-[0.12em]">Juego responsable · +18</span>
            <a
              href="/login"
              className="hover:text-[var(--color-fg-muted)] transition-colors uppercase tracking-[0.12em]"
              title="Acceso al panel admin"
            >
              ¿Sos operador?
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
