/**
 * /login — acceso al panel admin del tenant.
 *
 * Acoplado al panel: tarjeta del design system (`SectionCard`), `Input`/`Label`
 * del DS y CTA blanco (igual que el "Guardar" del panel). Monocromático porque
 * el layout scopea `.admin-neutral` sin inyectar acento → el foco/estados caen
 * en el gris del fallback. La lógica del form no cambia: react-hook-form + zod +
 * `useAuth().login(user, pass, 'panel')` + `getLoginErrorMessage`.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Loader2, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PanelMark } from '@/components/brand/panel-mark';
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
  // Se queda en `true` desde que el login es exitoso hasta que la página navega
  // a /dashboard (el componente se desmonta). Sin esto, el spinner se apagaba
  // apenas resolvía login() y el botón volvía a "Ingresar" mientras /dashboard
  // todavía cargaba (lento con cache limpio / backend frío) → parecía roto y el
  // usuario clickeaba de nuevo. NO se resetea en el flujo feliz a propósito.
  const [redirecting, setRedirecting] = useState(false);

  // Si ya hay sesión activa, redirigir a /dashboard.
  useEffect(() => {
    if (user) {
      setRedirecting(true);
      router.replace('/dashboard');
    }
  }, [user, router]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });

  // Botón ocupado: durante la autenticación (isSubmitting) y toda la navegación
  // posterior al dashboard (redirecting). Cubre la ventana en la que el login ya
  // resolvió pero la página todavía no cargó.
  const busy = isSubmitting || redirecting;

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      // Sprint 43 (security): audience='panel' rechaza players en backend
      // antes de emitir tokens. Defense-in-depth: el AuthProvider además
      // valida me.canAccessPanel y descarta sesión si no.
      await login(values.username, values.password, 'panel');
      // Login OK: mantené el botón cargando a través de la navegación (que puede
      // tardar por el refetch del dashboard). El componente se desmonta al
      // navegar, así que no hace falta resetear el flag.
      setRedirecting(true);
      router.replace('/dashboard');
    } catch (err) {
      setServerError(getLoginErrorMessage(err));
    }
  };

  return (
    <div className="flex animate-fade-up flex-col gap-5">
      {/* Encabezado: marca del panel + título. */}
      <div className="flex flex-col items-start gap-3">
        <PanelMark size={46} />
        <div>
          <h1 className="font-display text-[22px] font-bold text-[var(--color-fg)]">
            Panel de control
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-fg-muted)]">
            Ingresá con las credenciales que te asignó el administrador.
          </p>
        </div>
      </div>

      {/* Tarjeta — mismo estilo que las secciones del panel. */}
      <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        <div className="flex flex-col gap-4 px-5 py-5">
          {serverError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2.5"
              style={{ borderLeft: '2px solid var(--color-danger)' }}
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-danger)]" />
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-danger)]">
                  Acceso denegado
                </span>
                <span className="text-[12.5px] text-[var(--color-fg)]">
                  {serverError}
                </span>
              </div>
            </div>
          )}

          <form
            onSubmit={(e) => void handleSubmit(onSubmit)(e)}
            className="flex flex-col gap-4"
            noValidate
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Usuario</Label>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                invalid={!!errors.username}
                {...register('username')}
              />
              {errors.username && (
                <span className="text-[11px] text-[var(--color-danger)]">
                  {errors.username.message}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Contraseña</Label>
                <button
                  type="button"
                  className="text-[11px] text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]"
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
                {...register('password')}
              />
              {errors.password && (
                <span className="text-[11px] text-[var(--color-danger)]">
                  {errors.password.message}
                </span>
              )}
            </div>

            {/* CTA — mismo estilo que el "Guardar" del panel (blanco). El estado
                de carga cubre auth + navegación al dashboard (redirecting). */}
            <button
              type="submit"
              disabled={busy}
              className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-white py-2.5 text-sm font-semibold text-black shadow-sm transition-all duration-150 hover:brightness-110 hover:shadow-md active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 disabled:active:scale-100"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {isSubmitting ? 'Verificando…' : 'Ingresando…'}
                </>
              ) : (
                <>
                  Ingresar
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Nota al pie — sobria, sin decoración de sistema. */}
      <p className="text-center text-[11px] leading-[1.5] text-[var(--color-fg-subtle)]">
        Los intentos de acceso quedan registrados.
      </p>
    </div>
  );
}
