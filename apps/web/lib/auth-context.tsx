/**
 * AuthContext — estado global de autenticación del admin del tenant.
 *
 * Responsabilidades:
 *   - Mantener el token JWT en memoria + localStorage.
 *   - Exponer `user` (perfil del logueado) o null si no.
 *   - Métodos: login(username, password, audience?, turnstileToken?) / logout
 *     / reauth.
 *   - Sprint 37: `impersonate(targetUserId)` swappa al admin a otro user
 *     guardando el token original en sessionStorage. `stopImpersonating()`
 *     restaura. `user.impersonatedBy` permite a la UI mostrar banner.
 *   - Bootstrapeo: al cargar la app, si hay token persistido, llama
 *     `GET /tenant/auth/me` para validar y poblar `user`.
 *
 * Flujo 2FA: NO EXISTE. Este bloque describía un paso de código que el form
 * mostraría ante `TWO_FA_REQUIRED` — nunca se construyó, y `login()` jamás
 * aceptó un `twoFaCode`. La descripción quedó acá años como si funcionara, y
 * por eso nadie noto que quien activaba 2FA quedaba encerrado afuera: el
 * backend le pedía un código que ningún formulario sabía pedir.
 *
 * Desde 2026-08-27 el 2FA está apagado en toda la plataforma
 * (`TWO_FA_POLICY_ENABLED`, ver `two-fa-policy.service.ts`). Para reactivarlo
 * hay que construir ese paso primero: agregar `twoFaCode`/`recoveryCode` a
 * `login()` (el BFF ya reenvía el body tal cual y el backend ya los acepta) y
 * el campo en los dos formularios, panel y jugador.
 */

'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ApiError,
  apiGet,
  apiPost,
  getPanel,
  hasSessionHint,
  SESSION_EXPIRED_EVENT,
} from './api-client';
import { cacheAdminAppearance } from './admin-appearance';

export interface TenantUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  /**
   * Parte A perfil/wallet (docs/21): perfil editable por el jugador.
   * Llegan desde GET /tenant/auth/me (enriquecido). Optional por
   * compatibilidad con respuestas previas.
   */
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  language?: string;
  /**
   * Sprint 37: si la sesión actual es impersonate, el id del admin
   * original. NULL en sesiones normales.
   */
  impersonatedBy?: string | null;
  /**
   * Sprint 43 (security): códigos de rol del user en este tenant.
   * Vacío si la query falló — tratar como "sin acceso" por default-deny.
   */
  roles?: string[];
  /**
   * Sprint 43 (security): true si el user tiene al menos un rol con
   * panel access (cualquier rol distinto de `usuario_final`). El layout
   * /admin lo usa para redirigir a /play si false. Default deny si undefined.
   */
  canAccessPanel?: boolean;
  /**
   * Sprint 51.3: true si el user es socio con flag is_independent_branch.
   * La UI lo usa para:
   *   - mostrar tabs "mis plantillas / del tenant" en /admin/bonus-definitions.
   *   - mostrar banners read-only en /admin/promotions y /admin/leagues.
   * Default false si la query falla o no aplica.
   */
  isIndependentBranch?: boolean;
  /**
   * Sprint 55: true si el user NO es el socio titular pero está bajo
   * una sucursal independiente (ej. cajero/dealer de un socio indep).
   * Sirve para gating fino de UI (sidebar, botones).
   * Default false.
   */
  underIndependentBranch?: boolean;
  /**
   * Sprint 51.4: true si el user tiene 2FA habilitada. La UI lo usa
   * para mostrar el campo "código 2FA" en modales sensibles
   * (reset-password, force-clear). Default false.
   */
  twoFaEnabled?: boolean;
  /**
   * Permisos EFECTIVOS del actor (roles + overrides), tal como los calcula
   * el backend. La UI los usa para gatear botones por permiso —ej. mostrar
   * "Destruir fichas" solo a quien tenga `wallet.burn`—.
   * Es solo UX: el backend revalida cada operación. Default deny si undefined.
   */
  effectivePermissions?: string[];
}

/**
 * ¿El usuario logueado tiene el permiso `code` en su set efectivo?
 * Default-deny: si el set no llegó (undefined) o el user es null, devuelve
 * false. Espeja exactamente lo que valida el `PermissionsGuard` del backend.
 */
export function hasPermission(
  user: TenantUser | null,
  code: string,
): boolean {
  return user?.effectivePermissions?.includes(code) ?? false;
}

/**
 * ¿El user logueado es el admin del tenant? La "caja" del admin ES la Casa
 * (docs/16). Su wallet personal está por default en 0 y no tiene sentido
 * mostrársela como "mi balance".
 */
export function isAdminTenant(user: TenantUser | null): boolean {
  return user?.roles?.includes('admin_tenant') ?? false;
}

/**
 * ¿El user logueado es socio con `is_independent_branch=true`? El bankroll
 * de este socio es SU propia wallet — la Casa formal no la usa. Los widgets
 * de tesorería le muestran su propia salud vía `?operatorUserId=<self>`.
 */
export function isIndependentBranch(user: TenantUser | null): boolean {
  return !!user?.isIndependentBranch;
}

/**
 * "Audiencia" del usuario para adaptar textos de ayuda ("¿Cómo funciona?") y
 * copys por lo que REALMENTE hace, no por su rol nominal. Tres sabores:
 *   - `admin`       → la Casa central: ve y opera todo el tenant.
 *   - `independent` → opera dentro de una sub-red INDEPENDIENTE (el socio
 *                     independiente o alguien colgado de él): banca su propia
 *                     red (carga/aprueba/paga a sus hijos directos, R4).
 *   - `dependent`   → operador COMERCIAL puro (socio/distribuidor/cajero
 *                     dependiente): trae y gestiona su red + cobra comisión %,
 *                     pero NO mueve plata ni aprueba dep/retiros (R3). La plata
 *                     de la Casa la manejan el admin + sus empleados.
 * Es solo para NARRATIVA/UX; los permisos reales los valida el backend. Ver
 * docs/03-jerarquia-roles.md y docs/LEYES.md (R3/R4).
 */
export type OperatorAudience = 'admin' | 'independent' | 'dependent';

export function operatorAudience(user: TenantUser | null): OperatorAudience {
  if (isAdminTenant(user)) return 'admin';
  if (isIndependentBranch(user) || user?.underIndependentBranch === true) {
    return 'independent';
  }
  return 'dependent';
}

/**
 * Sprint 43: audience del login. Determina el flow:
 *   - 'panel'  → /login admin. Rechaza con NOT_PANEL_USER si el user
 *                solo tiene rol player.
 *   - 'player' → /play/login. No filtra por rol (admins pueden jugar).
 */
export type LoginAudience = 'panel' | 'player';

interface AuthContextValue {
  user: TenantUser | null;
  loading: boolean;
  login: (
    username: string,
    password: string,
    audience?: LoginAudience,
    turnstileToken?: string,
  ) => Promise<void>;
  /**
   * Adopta la sesión ya seteada en cookies (ej. tras el registro, que el BFF
   * auto-loguea seteando las cookies). Hace /me + puebla el user.
   */
  adoptSession: () => Promise<void>;
  /**
   * Cierra sesión. `redirectTo` permite que el caller indique dónde
   * mandar al user (default `/login` = admin). El player usa `/play/login`.
   */
  logout: (redirectTo?: string) => void;
  /**
   * Sprint 37: admin emite tokens "como" otro user. Guarda el token
   * original en sessionStorage para poder restaurarlo después.
   * Si el target es socio independiente, se requiere `reason` (audit critical).
   * Tira si el actor no tiene permission `users.impersonate` (403).
   */
  impersonate: (targetUserId: string, reason?: string) => Promise<TenantUser>;
  /**
   * Vuelve a la sesión del admin original (la que estaba antes de
   * `impersonate`). Si no hay token guardado, hace logout normal.
   */
  stopImpersonating: () => Promise<void>;
  /**
   * Re-fetchea `/tenant/auth/me` y actualiza el user en estado. Útil tras
   * operaciones self-service que cambian flags del user (ej. habilitar/
   * deshabilitar 2FA) para que la UI refleje el estado nuevo sin recargar.
   * No toca tokens.
   */
  refreshMe: () => Promise<void>;
  /** Auth modal state for player shell. */
  authModal: { loginOpen: boolean; registerOpen: boolean; registerRef?: string; next?: string };
  openLoginModal: (next?: string) => void;
  openRegisterModal: (ref?: string, next?: string) => void;
  closeAuthModal: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface MeResponse {
  user: TenantUser;
  tenant: { id: string; slug: string; name: string } | null;
}

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: ReactNode;
  /**
   * User resuelto SERVER-SIDE (Etapa 2). Si viene, se siembra el estado desde
   * él (via `useState` initializer → mismo render en server y cliente, sin
   * hydration mismatch) y se saltea el primer /me del bootstrap. Si es null
   * (guest, o kill-switch apagado), el flujo cliente resuelve como siempre.
   */
  initialUser?: TenantUser | null;
}) {
  const [user, setUser] = useState<TenantUser | null>(initialUser);
  // Si ya tenemos user del servidor, no estamos "cargando".
  const [loading, setLoading] = useState(initialUser == null);
  // Saltea exactamente UN bootstrap (el inicial del panel sembrado). Los
  // cambios de panel client-side siguen resolviendo normal.
  const skipFirstBootstrap = useRef(initialUser != null);
  const [authModal, setAuthModal] = useState<{
    loginOpen: boolean;
    registerOpen: boolean;
    registerRef?: string;
    next?: string;
  }>({ loginOpen: false, registerOpen: false });
  const router = useRouter();
  const queryClient = useQueryClient();
  // El panel activo se deriva de la ruta. Al navegar client-side entre
  // /dashboard y /play (sin recarga), `pathname` cambia y el bootstrap
  // corre de nuevo para montar la sesión del panel correcto — sesiones
  // admin y player son 100% independientes.
  const pathname = usePathname();
  const activePanel: 'admin' | 'player' =
    pathname.startsWith('/play') ? 'player' : 'admin';

  // Bootstrap: al montar (y al cambiar de panel) validar la sesión si hay hint
  // de sesión para ESE panel. El token vive en cookie httpOnly (JS no la ve);
  // la hint cookie legible indica presencia. Si /me falla, el api-client ya
  // intentó refresh; acá solo caemos a "no logueado".
  useEffect(() => {
    let cancelled = false;

    // El user ya vino sembrado del servidor para el panel activo → no re-fetchear
    // en el primer montaje (evita un /me redundante). Consumimos el skip una vez.
    if (skipFirstBootstrap.current) {
      skipFirstBootstrap.current = false;
      return;
    }

    if (!hasSessionHint(activePanel)) {
      setUser(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    apiGet<MeResponse>('/tenant/auth/me')
      .then((me) => {
        if (cancelled) return;
        setUser(me.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activePanel]);

  const login = useCallback(
    async (
      username: string,
      password: string,
      audience: LoginAudience = 'panel',
      turnstileToken?: string,
    ) => {
      // El BFF /api/auth/login autentica contra el backend y setea las cookies
      // httpOnly del panel (panel via X-Panel, que el api-client deriva de la
      // ruta). skipAuth: un 401 de credenciales se propaga sin intentar refresh.
      await apiPost(
        '/auth/login',
        { username, password, audience, turnstileToken },
        { skipAuth: true },
      );
      const me = await apiGet<MeResponse>('/tenant/auth/me');

      // Sprint 43 defense-in-depth: si el backend nos dejó loguear como
      // 'panel' pero /me reporta canAccessPanel=false, descartamos la sesión
      // (logout BFF limpia cookies) y tiramos NOT_PANEL_USER. Para 'player'
      // no aplica (admins pueden jugar).
      if (audience === 'panel' && me.user.canAccessPanel === false) {
        await apiPost('/auth/logout', undefined, { skipAuth: true }).catch(
          () => {},
        );
        throw new ApiError({
          status: 403,
          message: 'Esta cuenta es de jugador. Usá el acceso en /play/login.',
          code: 'NOT_PANEL_USER',
        });
      }

      setUser(me.user);
      // Cambió la identidad: limpiamos el cache de queries para que la
      // nueva sesión refetchee data scoped a SU rol (no la del user previo), y
      // el anti-flash de apariencia del panel (si no, pinta el diseño de la
      // cuenta anterior hasta que llega /tenant/info).
      queryClient.clear();
      cacheAdminAppearance(null);
    },
    [queryClient],
  );

  const adoptSession = useCallback(async () => {
    // La sesión ya quedó en cookies (ej. el BFF de registro la seteó). Poblar user.
    const me = await apiGet<MeResponse>('/tenant/auth/me');
    setUser(me.user);
    queryClient.clear();
    cacheAdminAppearance(null);
  }, [queryClient]);

  const openLoginModal = useCallback((next?: string) => {
    setAuthModal({ loginOpen: true, registerOpen: false, next });
  }, []);

  const openRegisterModal = useCallback((ref?: string, next?: string) => {
    setAuthModal({ loginOpen: false, registerOpen: true, registerRef: ref, next });
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModal({ loginOpen: false, registerOpen: false });
  }, []);

  const logout = useCallback(
    (redirectTo: string = '/login') => {
      // Las sesiones de admin y player son INDEPENDIENTES: el BFF /api/auth/logout
      // revoca en el backend y limpia las cookies SOLO del panel actual (via
      // X-Panel). ESPERAMOS a que el logout limpie las cookies (Set-Cookie) ANTES
      // de navegar: si navegamos a /login con las cookies todavía presentes, el
      // middleware/SSR pueden ver el refresh token y RE-EMITIR la sesión
      // (re-logueo automático). El IIFE mantiene la firma síncrona (=> void); el
      // .catch asegura que un fallo de red no bloquee el logout local.
      void (async () => {
        await apiPost('/auth/logout', undefined, { skipAuth: true }).catch(() => {
          // noop: seguimos con logout local.
        });
        setUser(null);
        // Limpiar el cache: la próxima sesión arranca sin data de la anterior.
        queryClient.clear();
        // Limpiar el anti-flash de apariencia del panel: si no, al entrar con OTRA
        // cuenta el panel pinta el diseño de la anterior hasta que llega /tenant/info.
        cacheAdminAppearance(null);
        router.replace(redirectTo);
      })();
    },
    [router, queryClient],
  );

  const impersonate = useCallback(
    async (targetUserId: string, reason?: string): Promise<TenantUser> => {
      // El BFF autoriza con la cookie del admin, emite tokens del impersonado,
      // decide el panel destino (admin/player), respalda la sesión previa de ese
      // panel en cookies `casino_orig_*` y la pisa con la del impersonado.
      const res = await apiPost<{ user: TenantUser }>(
        `/auth/impersonate/${targetUserId}`,
        reason ? { reason } : {},
      );
      setUser(res.user);
      // Cambió la identidad → limpiamos el cache para no mostrarle al
      // impersonado la data cacheada del admin.
      queryClient.clear();
      // El caller redirige (panel si operador, /play si jugador) según canAccessPanel.
      return res.user;
    },
    [queryClient],
  );

  const stopImpersonating = useCallback(async () => {
    // El BFF restaura la sesión previa del panel actual (o la limpia). La sesión
    // "casa" del admin (casino_admin_*) quedó intacta o restaurada. Recargamos
    // duro a /dashboard: re-bootstrapea como el admin sin edge cases de estado SPA.
    await apiPost('/auth/stop-impersonating', undefined, {
      skipAuth: true,
    }).catch(() => {});
    queryClient.clear();
    if (typeof window !== 'undefined') {
      window.location.href = '/dashboard';
    }
  }, [queryClient]);

  // Sesión expirada: el api-client dispara SESSION_EXPIRED_EVENT cuando un
  // request autenticado recibe 401 y el refresh también falló. Acá cerramos
  // sesión y mandamos al login correcto — sino el usuario queda en un panel
  // "logueado" donde todo falla en silencio.
  useEffect(() => {
    const onExpired = () => {
      if (typeof window === 'undefined') return;
      // Solo si todavía había sesión (evita redirigir estando ya deslogueado
      // o disparar dos veces ante una ráfaga de 401 simultáneos).
      if (!hasSessionHint(getPanel())) return;
      const dest = window.location.pathname.startsWith('/play')
        ? '/play/login'
        : '/login';
      toast.error('Tu sesión expiró', {
        description: 'Volvé a iniciar sesión para continuar.',
      });
      void logout(dest);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [logout]);

  // Re-fetch de /me para actualizar flags del user tras operaciones
  // self-service (2FA on/off, etc). No toca tokens.
  const refreshMe = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!hasSessionHint(getPanel())) return;
    const me = await apiGet<MeResponse>('/tenant/auth/me');
    setUser(me.user);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, adoptSession, logout, impersonate, stopImpersonating, refreshMe, authModal, openLoginModal, openRegisterModal, closeAuthModal }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  }
  return ctx;
}

export interface LoginErrorInfo {
  /** Título del cartel (situación). */
  title: string;
  /** Mensaje explicativo para el jugador. */
  message: string;
  /** Código del backend (si aplica) para diferenciar el estilo del cartel. */
  code?: string;
  /**
   * true si es un problema de estado de la cuenta (bloqueada/suspendida/
   * inactiva/pendiente/autoexcluida) — el password YA se validó. El cartel
   * se muestra más prominente e invita a soporte.
   */
  isAccountStatus: boolean;
}

/**
 * Códigos 401 cuyo mensaje del backend SÍ se muestra tal cual: el password ya
 * se validó (es el dueño real), así que informar la situación no filtra nada.
 * Título en criollo por código.
 */
const ACCOUNT_STATUS_TITLES: Record<string, string> = {
  ACCOUNT_BANNED: 'Cuenta bloqueada',
  ACCOUNT_SUSPENDED: 'Cuenta suspendida',
  ACCOUNT_INACTIVE: 'Cuenta inactiva',
  ACCOUNT_PENDING: 'Cuenta pendiente de activación',
  ACCOUNT_UNAVAILABLE: 'Cuenta no disponible',
  ACCOUNT_LOCKED: 'Cuenta bloqueada temporalmente',
  USER_EXCLUDED: 'Cuenta autoexcluida',
};

/** Info completa (título + mensaje) del error de login para el cartel. */
export function getLoginErrorInfo(err: unknown): LoginErrorInfo {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const apiErr = err as ApiError;
    const code = apiErr.code;
    if (apiErr.status === 401) {
      // Estado de cuenta / lockout / autoexclusión: el backend ya validó el
      // password, así que mostramos su mensaje real + título de la situación.
      if (code && code in ACCOUNT_STATUS_TITLES && apiErr.message) {
        return {
          title: ACCOUNT_STATUS_TITLES[code]!,
          message: apiErr.message,
          code,
          isAccountStatus: true,
        };
      }
      // Credenciales incorrectas: mensaje genérico por seguridad.
      return {
        title: 'No pudimos ingresarte',
        message: 'Usuario o contraseña incorrectos.',
        code,
        isAccountStatus: false,
      };
    }
    // Sprint 43 (security): un player intentando entrar al panel admin.
    if (apiErr.status === 403 && code === 'NOT_PANEL_USER') {
      return {
        title: 'Acceso de jugador',
        message:
          apiErr.message ||
          'Esta cuenta es de jugador. Usá el acceso en /play/login.',
        code,
        isAccountStatus: false,
      };
    }
    if (apiErr.status === 429) {
      return {
        title: 'Demasiados intentos',
        message: 'Esperá un minuto e intentá de nuevo.',
        code,
        isAccountStatus: false,
      };
    }
    if (apiErr.status >= 500) {
      return {
        title: 'Error del servidor',
        message: 'Intentá de nuevo en un momento.',
        code,
        isAccountStatus: false,
      };
    }
    return {
      title: 'No pudimos ingresarte',
      message: apiErr.message || 'Error inesperado al iniciar sesión.',
      code,
      isAccountStatus: false,
    };
  }
  return {
    title: 'Sin conexión',
    message: 'Verificá tu red e intentá de nuevo.',
    isAccountStatus: false,
  };
}

/** Helper para extraer solo el mensaje legible (back-compat). */
export function getLoginErrorMessage(err: unknown): string {
  return getLoginErrorInfo(err).message;
}
