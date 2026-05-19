/**
 * /login — formulario de acceso al panel admin del tenant.
 *
 * Stack del form: react-hook-form + zod resolver + integración directa
 * con `useAuth().login(...)`. Errores del backend (401, 403, 429, 5xx)
 * se muestran en banner inline arriba del form, no en toast.
 *
 * Detalles visuales:
 *   - Label tipo terminal (caps + tracking ancho).
 *   - Inputs altos (h-10) para "weight" visual + tap targets mobile.
 *   - Botón primario con loading state (spinner red sobre red).
 *   - Banner de error con border-l rojo + bg-stripes danger.
 *   - Link "olvidé mi contraseña" muted, sin underline default.
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
import { getLoginErrorMessage, useAuth } from '@/lib/auth-context';

const schema = z.object({
  username: z.string().min(1, { message: 'Ingresá tu usuario.' }),
  password: z.string().min(1, { message: 'Ingresá tu contraseña.' }),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { user, login } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  // Si ya hay sesión activa, redirigir a /dashboard.
  useEffect(() => {
    if (user) router.replace('/dashboard');
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
      await login(values.username, values.password);
      router.replace('/dashboard');
    } catch (err) {
      setServerError(getLoginErrorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Header del form */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
          Acceso · Operador
        </span>
        <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
          Ingresá a tu panel
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1">
          Usá las credenciales que te asignó el administrador del tenant.
        </p>
      </div>

      {/* Server error banner */}
      {serverError && (
        <div
          role="alert"
          className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)]"
        >
          <ShieldAlert className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
              Acceso denegado
            </span>
            <span className="text-[13px] text-[var(--color-fg)]">{serverError}</span>
          </div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
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
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Contraseña</Label>
            <button
              type="button"
              className="text-[11px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] uppercase tracking-[0.08em] transition-colors"
              onClick={() => {
                // Placeholder — flow de recovery codes lo armamos después.
                setServerError('Contactá al admin del tenant para resetear.');
              }}
            >
              Olvidé
            </button>
          </div>
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

        <Button type="submit" size="lg" disabled={isSubmitting} className="mt-2 w-full">
          {isSubmitting ? (
            <>
              <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
              Verificando…
            </>
          ) : (
            <>
              Ingresar
              <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </form>

      {/* Footer: meta info */}
      <div className="flex items-center justify-between text-[11px] text-[var(--color-fg-subtle)] pt-6 border-t border-[var(--color-border)]">
        <span className="font-mono">
          tenant://{(process.env.NEXT_PUBLIC_TENANT_HOST ?? 'demo.localhost').split('.')[0]}
        </span>
        <span className="uppercase tracking-[0.12em]">v0.1.0</span>
      </div>
    </div>
  );
}
