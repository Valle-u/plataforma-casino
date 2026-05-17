/**
 * AuthContext — estado global de autenticación del admin del tenant.
 *
 * Responsabilidades:
 *   - Mantener el token JWT en memoria + localStorage.
 *   - Exponer `user` (perfil del logueado) o null si no.
 *   - Métodos: login(username, password, twoFaCode?) / logout / reauth.
 *   - Bootstrapeo: al cargar la app, si hay token persistido, llama
 *     `GET /tenant/auth/me` para validar y poblar `user`.
 *
 * Flujo 2FA:
 *   - Si el login devuelve 200 con `accessToken`: éxito directo.
 *   - Si devuelve 401/403 con `error: 'TWO_FA_REQUIRED'`: el form
 *     muestra el campo `code` y se reintenta con `twoFaCode`.
 *   - Hoy MVP: login simple username/password. 2FA se agrega después
 *     conforme se necesita (el backend ya lo soporta).
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
}

interface AuthContextValue {
  user: TenantUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  /**
   * Cierra sesión. `redirectTo` permite que el caller indique dónde
   * mandar al user (default `/login` = admin). El player usa `/play/login`.
   */
  logout: (redirectTo?: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface LoginResponse {
  accessToken: string;
  user?: TenantUser;
}

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

    apiGet<TenantUser>('/tenant/auth/me')
      .then((u) => {
        if (cancelled) return;
        setUser(u);
      })
      .catch(() => {
        // Token inválido/expirado: limpiar.
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

  const login = useCallback(async (username: string, password: string) => {
    const data = await apiPost<LoginResponse>(
      '/tenant/auth/login',
      { username, password },
      { skipAuth: true },
    );
    setToken(data.accessToken);
    // El endpoint /login no devuelve el user completo — re-fetch /me.
    const me = await apiGet<TenantUser>('/tenant/auth/me');
    setUser(me);
  }, []);

  const logout = useCallback(
    (redirectTo: string = '/login') => {
      setToken(null);
      setUser(null);
      router.replace(redirectTo);
    },
    [router],
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
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
    if (apiErr.status === 401) return 'Usuario o contraseña incorrectos.';
    if (apiErr.status === 429) return 'Demasiados intentos. Esperá un minuto.';
    if (apiErr.status >= 500) return 'Error del servidor. Intentá de nuevo.';
    return apiErr.message || 'Error inesperado al iniciar sesión.';
  }
  return 'Error de conexión. Verificá tu red.';
}
