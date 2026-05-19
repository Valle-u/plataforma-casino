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
import { apiGet, apiPost, setToken, type ApiError } from './api-client';

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
   * Cierra sesión. `redirectTo` permite que el caller indique dónde
   * mandar al user (default `/login` = admin). El player usa `/play/login`.
   */
  logout: (redirectTo?: string) => void;
  /**
   * Sprint 37: admin emite tokens "como" otro user. Guarda el token
   * original en sessionStorage para poder restaurarlo después.
   * Tira si el actor no tiene permission `users.impersonate` (403).
   */
  impersonate: (targetUserId: string) => Promise<void>;
  /**
   * Vuelve a la sesión del admin original (la que estaba antes de
   * `impersonate`). Si no hay token guardado, hace logout normal.
   */
  stopImpersonating: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface MeResponse {
  user: TenantUser;
  tenant: { id: string; slug: string; name: string } | null;
}

interface LoginResponse {
  accessToken: string;
}

const ORIGINAL_TOKEN_KEY = 'casino_admin_original_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TenantUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Bootstrap: al montar, intentar reauth si hay token guardado.
  useEffect(() => {
    let cancelled = false;
    const token =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('casino_admin_token')
        : null;

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
        setToken(null);
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
      const me = await apiGet<MeResponse>('/tenant/auth/me');

      // Sprint 43 defense-in-depth: si el backend nos dejó loguear como
      // 'panel' pero por algún motivo /me reporta canAccessPanel=false
      // (data inconsistente, race en el seed, etc.), descartamos la
      // sesión y tiramos error. La UI debe interpretarlo como
      // NOT_PANEL_USER y mostrar el mensaje correcto. Para audience
      // 'player' no aplicamos este check (admins pueden jugar).
      if (audience === 'panel' && me.user.canAccessPanel === false) {
        setToken(null);
        const err: ApiError = {
          status: 403,
          message: 'Esta cuenta es de jugador. Usá el acceso en /play/login.',
          code: 'NOT_PANEL_USER',
        };
        throw err;
      }

      setUser(me.user);
      // Si había un token "original" guardado de una sesión previa de
      // impersonate, lo limpiamos — el login fresh es definitivo.
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(ORIGINAL_TOKEN_KEY);
      }
    },
    [],
  );

  const logout = useCallback(
    (redirectTo: string = '/login') => {
      setToken(null);
      setUser(null);
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(ORIGINAL_TOKEN_KEY);
      }
      router.replace(redirectTo);
    },
    [router],
  );

  const impersonate = useCallback(async (targetUserId: string) => {
    // Guardar el token actual ANTES de pisarlo, para poder volver.
    if (typeof window !== 'undefined') {
      const current = window.localStorage.getItem('casino_admin_token');
      if (current) {
        window.sessionStorage.setItem(ORIGINAL_TOKEN_KEY, current);
      }
    }
    const data = await apiPost<LoginResponse>(
      `/tenant/auth/impersonate/${targetUserId}`,
      {},
    );
    setToken(data.accessToken);
    const me = await apiGet<MeResponse>('/tenant/auth/me');
    setUser(me.user);
  }, []);

  const stopImpersonating = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const original = window.sessionStorage.getItem(ORIGINAL_TOKEN_KEY);
    if (!original) {
      // Fallback: si no hay token guardado, logout limpio.
      logout('/login');
      return;
    }
    setToken(original);
    window.sessionStorage.removeItem(ORIGINAL_TOKEN_KEY);
    try {
      const me = await apiGet<MeResponse>('/tenant/auth/me');
      setUser(me.user);
      router.replace('/dashboard');
    } catch {
      // Si el token original expiró, logout y a login.
      logout('/login');
    }
  }, [logout, router]);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, impersonate, stopImpersonating }}
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
