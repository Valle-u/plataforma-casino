/**
 * /login — acceso al panel admin del tenant (rediseño v2, monocromático).
 *
 * Solo cambia lo ESTÉTICO: el form sigue siendo react-hook-form + zod +
 * `useAuth().login(user, pass, 'panel')` + `getLoginErrorMessage`. Sin acento
 * de marca: CTA blanco sobre negro, foco gris, y como únicas señales de color
 * el verde de "Servicio operativo" y el rojo de error. La marca es la del
 * producto (Retícula), no la del tenant.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type CSSProperties } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PanelMark } from '@/components/brand/panel-mark';
import { cn } from '@/lib/cn';
import { getLoginErrorMessage, useAuth } from '@/lib/auth-context';

const schema = z.object({
  username: z.string().min(1, { message: 'Ingresá tu usuario.' }),
  password: z.string().min(1, { message: 'Ingresá tu contraseña.' }),
});

type FormValues = z.infer<typeof schema>;

// Solo layout/tipografía. El borde y la sombra (reposo/foco/error) van por
// estilo INLINE — en Tailwind v4 acá los `border-[hex]`/`shadow-[...]`
// arbitrarios y hasta las clases propias pierden por cascade layers; inline
// gana siempre.
const fieldCls =
  'h-[52px] w-full rounded-[11px] border border-solid bg-[#171717] px-3.5 text-[16px] text-[var(--color-fg)] outline-none placeholder:text-[#5c5c5c] sm:h-11 sm:rounded-[10px] sm:text-[13.5px]';

const labelCls =
  'font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#8a8a8a]';

/** Borde + sombra del input según estado (inline → gana sobre las capas). */
function fieldStyle(focused: boolean, hasError: boolean): CSSProperties {
  if (hasError) {
    return {
      borderColor: '#f2555a',
      boxShadow: '0 0 0 3px rgba(242, 85, 90, 0.18)',
    };
  }
  if (focused) {
    return {
      borderColor: '#6b6b6b',
      boxShadow: '0 0 0 3px rgba(250, 250, 250, 0.07)',
    };
  }
  return { borderColor: '#202020' };
}

export default function LoginPage() {
  const router = useRouter();
  const { user, login } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [ctaHover, setCtaHover] = useState(false);

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

  const usernameReg = register('username');
  const passwordReg = register('password');

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      // Sprint 43 (security): audience='panel' rechaza players en backend
      // antes de emitir tokens. Defense-in-depth: el AuthProvider además
      // valida me.canAccessPanel y descarta sesión si no.
      await login(values.username, values.password, 'panel');
      router.replace('/dashboard');
    } catch (err) {
      setServerError(getLoginErrorMessage(err));
    }
  };

  return (
    <div className="flex w-full max-w-[412px] animate-fade-up flex-col gap-5">
      {/* Encabezado: marca del panel + título. */}
      <div className="flex flex-col gap-[14px]">
        <PanelMark size={52} />
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[#5c5c5c]">
            <span className="sm:hidden">Acceso restringido</span>
            <span className="hidden sm:inline">
              Acceso restringido · Operadores
            </span>
          </span>
          <h1 className="font-display text-[27px] font-bold tracking-[-0.02em] text-[var(--color-fg)] sm:text-[30px]">
            Panel de control
          </h1>
        </div>
      </div>

      {/* Tarjeta. */}
      <div className="overflow-hidden rounded-[16px] border border-[#202020] bg-[#111111]">
        <div className="flex flex-col gap-[18px] p-5 sm:p-7">
          {/* Banner de error del servidor. */}
          {serverError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-[11px] px-3 py-2.5"
              style={{
                border: '1px solid rgba(242, 85, 90, 0.28)',
                borderLeft: '2px solid #f2555a',
                background: 'rgba(242, 85, 90, 0.06)',
              }}
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[#f2828a]" />
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#f2828a]">
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
            className="flex flex-col gap-[18px]"
            noValidate
          >
            <div className="flex flex-col gap-2">
              <label htmlFor="username" className={labelCls}>
                Usuario
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                className={fieldCls}
                style={fieldStyle(focusedField === 'username', !!errors.username)}
                {...usernameReg}
                onFocus={() => setFocusedField('username')}
                onBlur={(e) => {
                  void usernameReg.onBlur(e);
                  setFocusedField(null);
                }}
              />
              {errors.username && (
                <span className="text-[11.5px] text-[#f2828a]">
                  {errors.username.message}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className={labelCls}>
                  Contraseña
                </label>
                <button
                  type="button"
                  className="border-b border-[#333] text-[11.5px] text-[#8a8a8a] transition-colors hover:text-[var(--color-fg)]"
                  onClick={() => {
                    // Placeholder — flow de recovery codes lo armamos después.
                    setServerError('Contactá al admin del tenant para resetear.');
                  }}
                >
                  Olvidé
                </button>
              </div>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className={cn(fieldCls, 'font-mono tracking-[0.2em]')}
                style={fieldStyle(focusedField === 'password', !!errors.password)}
                {...passwordReg}
                onFocus={() => setFocusedField('password')}
                onBlur={(e) => {
                  void passwordReg.onBlur(e);
                  setFocusedField(null);
                }}
              />
              {errors.password && (
                <span className="text-[11.5px] text-[#f2828a]">
                  {errors.password.message}
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              onMouseEnter={() => setCtaHover(true)}
              onMouseLeave={() => setCtaHover(false)}
              style={
                !isSubmitting && ctaHover
                  ? {
                      background: '#ffffff',
                      boxShadow: '0 6px 18px -8px rgba(255, 255, 255, 0.35)',
                    }
                  : undefined
              }
              className={cn(
                'mt-1 flex h-[52px] w-full items-center justify-center gap-2 rounded-[11px] text-[14px] font-bold transition-all disabled:cursor-not-allowed sm:h-[46px]',
                isSubmitting
                  ? 'bg-[#2b2b2b] text-[#a8a8a8]'
                  : 'bg-[#fafafa] text-[#0b0b0b]',
              )}
            >
              {isSubmitting ? (
                <>
                  <span className="size-[13px] animate-spin rounded-full border-2 border-current border-r-transparent" />
                  Verificando…
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

        {/* Pie de la tarjeta: estado del sistema. */}
        <div className="flex items-center justify-between border-t border-[#1c1c1c] bg-[#0e0e0e] px-5 py-3 font-mono text-[10.5px] text-[#5c5c5c]">
          <span className="flex items-center gap-1.5">
            <span className="size-[5px] rounded-full bg-[var(--color-success)]" />
            Servicio operativo
          </span>
          <span>12 ms</span>
        </div>
      </div>

      {/* Nota al pie. */}
      <p className="text-[11.5px] leading-[1.55] text-[#5c5c5c]">
        Los intentos de acceso quedan registrados.
        <span className="hidden sm:inline">
          {' '}
          Si perdiste las credenciales, contactá al administrador del tenant.
        </span>
      </p>
    </div>
  );
}
