/**
 * AuthContext — estado global de autenticación del admin del tenant.
 *
 * Responsabilidades:
 *   - Mantener el token JWT en memoria + localStorage.
 *   - Exponer `user` (perfil del logueado) o null si no.
 *   - Métodos: login(username, password, twoFaCode?) / logout / reauth.
 *   - Sprint 37: `impersonate(targetUserId)` swappa al admin a otro user
 *     guardando el token original en sessionStorage. `stopImpersonating()`
 *     restaura. `user.impersonatedBy` permite a la UI mostrar banner.
 *   - Bootstrapeo: al cargar la app, si hay token persistido, llama
 *     `GET /tenant/auth/me` para validar y poblar `user`.
 *
 * Flujo 2FA:
 *   - Si el login devuelve 200 con `accessToken`: éxito directo.
 *   - Si devuelve 401/403 con `error: 'TWO_FA_REQUIRED'`: el form
 *     muestra el campo `code` y se reintenta con `twoFaCode`.
 *   - Hoy MVP: login simple username/password.
 */

'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ApiError,
  apiGet,
  apiPost,
  clearAuthTokens,
  getToken,
  getRefreshToken,
  setRefreshToken,
  setToken,
  SESSION_EXPIRED_EVENT,
} from './api-client';

export interface TenantUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
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
  ) => Promise<void>;
  /**
   * Set tokens directly (e.g. after registration which returns JWT inline).
   * Stores tokens, fetches /me, sets user state.
   */
  setTokens: (accessToken: string, refreshToken: string) => Promise<void>;
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

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

const ORIGINAL_TOKENS_KEY = 'casino_admin_original_tokens';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TenantUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authModal, setAuthModal] = useState<{
    loginOpen: boolean;
    registerOpen: boolean;
    registerRef?: string;
    next?: string;
  }>({ loginOpen: false, registerOpen: false });
  const router = useRouter();
  const queryClient = useQueryClient();

  // Bootstrap: al montar, intentar reauth si hay token guardado.
  useEffect(() => {
    let cancelled = false;
    const token =
      typeof window !== 'undefined' ? getToken() : null;

    if (!token) {
      setLoading(false);
      return;
    }

    apiGet<MeResponse>('/tenant/auth/me')
      .then((me) => {
        if (cancelled) return;
        setUser(me.user);
      })
      .catch(() => {
        clearAuthTokens();
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (
      username: string,
      password: string,
      audience: LoginAudience = 'panel',
    ) => {
      const data = await apiPost<LoginResponse>(
        '/tenant/auth/login',
        { username, password, audience },
        { skipAuth: true },
      );
      setToken(data.accessToken);
      setRefreshToken(data.refreshToken);
      const me = await apiGet<MeResponse>('/tenant/auth/me');

      // Sprint 43 defense-in-depth: si el backend nos dejó loguear como
      // 'panel' pero por algún motivo /me reporta canAccessPanel=false
      // (data inconsistente, race en el seed, etc.), descartamos la
      // sesión y tiramos error. La UI debe interpretarlo como
      // NOT_PANEL_USER y mostrar el mensaje correcto. Para audience
      // 'player' no aplicamos este check (admins pueden jugar).
      if (audience === 'panel' && me.user.canAccessPanel === false) {
        clearAuthTokens();
        throw new ApiError({
          status: 403,
          message: 'Esta cuenta es de jugador. Usá el acceso en /play/login.',
          code: 'NOT_PANEL_USER',
        });
      }

      setUser(me.user);
      // Cambió la identidad: limpiamos el cache de queries para que la
      // nueva sesión refetchee data scoped a SU rol (no la del user previo).
      queryClient.clear();
      // Si había tokens "originales" guardados de una sesión previa de
      // impersonate, los limpiamos — el login fresh es definitivo.
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(ORIGINAL_TOKENS_KEY);
      }
    },
    [queryClient],
  );

  const setTokens = useCallback(
    async (accessToken: string, refreshToken: string) => {
      setToken(accessToken);
      setRefreshToken(refreshToken);
      const me = await apiGet<MeResponse>('/tenant/auth/me');
      setUser(me.user);
      queryClient.clear();
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(ORIGINAL_TOKENS_KEY);
      }
    },
    [queryClient],
  );

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
      // Best-effort: avisar al backend para revocar el refresh token.
      // No esperamos la respuesta: si falla (red, token ya vencido),
      // igual limpiamos local state.
      const refreshToken =
        typeof window !== 'undefined' ? getRefreshToken() : null;
      if (refreshToken) {
        void apiPost('/tenant/auth/logout', { refreshToken }).catch(() => {
          // noop: seguimos con logout local.
        });
      }
      clearAuthTokens();
      setUser(null);
      // Limpiar el cache: la próxima sesión arranca sin data de la anterior.
      queryClient.clear();
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(ORIGINAL_TOKENS_KEY);
      }
      router.replace(redirectTo);
    },
    [router, queryClient],
  );

  const impersonate = useCallback(
    async (targetUserId: string, reason?: string): Promise<TenantUser> => {
      // Guardar los tokens actuales ANTES de pisarlos, para poder volver.
      if (typeof window !== 'undefined') {
        const accessToken = getToken();
        const refreshToken = getRefreshToken();
        if (accessToken && refreshToken) {
          const stored: StoredTokens = { accessToken, refreshToken };
          window.sessionStorage.setItem(
            ORIGINAL_TOKENS_KEY,
            JSON.stringify(stored),
          );
        }
      }
      const data = await apiPost<LoginResponse>(
        `/tenant/auth/impersonate/${targetUserId}`,
        reason ? { reason } : {},
      );
      setToken(data.accessToken);
      setRefreshToken(data.refreshToken);
      const me = await apiGet<MeResponse>('/tenant/auth/me');
      setUser(me.user);
      // Cambió la identidad → limpiamos el cache para no mostrarle al
      // impersonado la data cacheada del admin (ej. la lista de TODOS los
      // usuarios, cuando el target solo debería ver los de su red).
      queryClient.clear();
      // Devolvemos el user impersonado para que el caller decida a dónde
      // redirigir (panel si es operador, /play si es jugador).
      return me.user;
    },
    [queryClient],
  );

  const stopImpersonating = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const raw = window.sessionStorage.getItem(ORIGINAL_TOKENS_KEY);
    if (!raw) {
      // Fallback: si no hay tokens guardados, logout limpio.
      logout('/login');
      return;
    }

    let original: StoredTokens | null = null;
    try {
      original = JSON.parse(raw) as StoredTokens;
    } catch {
      window.sessionStorage.removeItem(ORIGINAL_TOKENS_KEY);
      logout('/login');
      return;
    }

    setToken(original.accessToken);
    setRefreshToken(original.refreshToken);
    window.sessionStorage.removeItem(ORIGINAL_TOKENS_KEY);
    try {
      const me = await apiGet<MeResponse>('/tenant/auth/me');
      setUser(me.user);
      // Volvimos al admin original → limpiamos el cache del impersonado.
      queryClient.clear();
      router.replace('/dashboard');
    } catch {
      // Si el token original expiró, logout y a login.
      logout('/login');
    }
  }, [logout, router, queryClient]);

  // Sesión expirada: el api-client dispara SESSION_EXPIRED_EVENT cuando un
  // request autenticado recibe 401 y el refresh también falló. Acá cerramos
  // sesión y mandamos al login correcto — sino el usuario queda en un panel
  // "logueado" donde todo falla en silencio.
  useEffect(() => {
    const onExpired = () => {
      if (typeof window === 'undefined') return;
      // Solo si todavía había sesión (evita redirigir estando ya deslogueado
      // o disparar dos veces ante una ráfaga de 401 simultáneos).
      if (!getToken()) return;
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

  return (
    <AuthContext.Provider
      value={{ user, loading, login, setTokens, logout, impersonate, stopImpersonating, authModal, openLoginModal, openRegisterModal, closeAuthModal }}
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

/** Helper para extraer mensaje legible de error de login. */
export function getLoginErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const apiErr = err as ApiError;
    if (apiErr.status === 401) {
      // Sprint 33+: si la 401 es por auto-exclusión, surface el mensaje
      // real (ya reveló info — credentials válidas pero blocked).
      // Para credentials incorrectas, generic message por security.
      if (apiErr.code === 'USER_EXCLUDED' && apiErr.message) {
        return apiErr.message;
      }
      return 'Usuario o contraseña incorrectos.';
    }
    // Sprint 43 (security): un player intentando entrar al panel admin.
    // El backend ya validó credentials OK pero rechazó por rol. Devolvemos
    // mensaje específico que invita al flow correcto, sin filtrar info
    // útil (un atacante con credentials buenas ya las tiene de todas formas).
    if (apiErr.status === 403 && apiErr.code === 'NOT_PANEL_USER') {
      return (
        apiErr.message ||
        'Esta cuenta es de jugador. Usá el acceso en /play/login.'
      );
    }
    if (apiErr.status === 429) return 'Demasiados intentos. Esperá un minuto.';
    if (apiErr.status >= 500) return 'Error del servidor. Intentá de nuevo.';
    return apiErr.message || 'Error inesperado al iniciar sesión.';
  }
  return 'Error de conexión. Verificá tu red.';
}
