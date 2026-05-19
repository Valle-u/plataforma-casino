/**
 * Helpers para crear/configurar test data via API REST (más rápido +
 * estable que vía UI).
 *
 * Convención: cada spec crea sus propios users con prefix `e2e_<suite>_`
 * y password fijo (no rotamos secrets en tests). Si el dueño quiere
 * cleanup post-run, agregar un `afterAll` que delete via SQL — hoy NO
 * está implementado.
 */

import { request, type APIRequestContext } from '@playwright/test';

const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:3000';
const TENANT_HOST = process.env.E2E_TENANT_HOST ?? 'demo.localhost';

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'demo_admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'demo-pwd-2026';

interface RequestOptions {
  headers?: Record<string, string>;
}

export class ApiClient {
  private constructor(
    private readonly ctx: APIRequestContext,
    private token: string | null = null,
  ) {}

  static async create(): Promise<ApiClient> {
    const ctx = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: { 'X-Tenant-Host': TENANT_HOST },
    });
    return new ApiClient(ctx);
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...(extra ?? {}) };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    const res = await this.ctx.post(path, {
      data: body ?? {},
      headers: this.buildHeaders(opts?.headers),
    });
    if (!res.ok()) {
      throw new Error(`POST ${path} → ${res.status()} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  async get<T>(path: string, opts?: RequestOptions): Promise<T> {
    const res = await this.ctx.get(path, {
      headers: this.buildHeaders(opts?.headers),
    });
    if (!res.ok()) {
      throw new Error(`GET ${path} → ${res.status()} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  async patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    const res = await this.ctx.patch(path, {
      data: body ?? {},
      headers: this.buildHeaders(opts?.headers),
    });
    if (!res.ok()) {
      throw new Error(`PATCH ${path} → ${res.status()} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Helpers de alto nivel
// ──────────────────────────────────────────────────────────────────────

interface LoginResponse {
  accessToken: string;
  user: { id: string; username: string; displayName: string | null };
}

export async function loginAsAdmin(api: ApiClient): Promise<string> {
  const res = await api.post<LoginResponse>('/tenant/auth/login', {
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });
  api.setToken(res.accessToken);
  return res.accessToken;
}

export async function loginAs(
  api: ApiClient,
  username: string,
  password: string,
): Promise<string> {
  const res = await api.post<LoginResponse>('/tenant/auth/login', {
    username,
    password,
  });
  api.setToken(res.accessToken);
  return res.accessToken;
}

export interface TestPlayer {
  id: string;
  username: string;
  password: string;
}

export async function createTestPlayer(
  api: ApiClient,
  label: string,
): Promise<TestPlayer> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const username = `e2e_${label}_${suffix}`.toLowerCase().slice(0, 30);
  const password = `e2e-pwd-${label}-2026`;
  const res = await api.post<{ user: { id: string } }>('/tenant/users', {
    username,
    password,
    displayName: `E2E ${label}`,
    roleCode: 'usuario_final',
  });
  return { id: res.user.id, username, password };
}

/**
 * Mintea chips al admin (su propia wallet) y luego load al player.
 * Asume que el ApiClient ya está logueado como admin (token seteado).
 */
export async function fundPlayer(
  api: ApiClient,
  playerId: string,
  amount: string,
): Promise<void> {
  const k = (label: string): string =>
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await api.post(
    '/tenant/wallet/mint',
    { amount, reason: 'e2e funding' },
    { headers: { 'Idempotency-Key': k('e2e-mint') } },
  );
  await api.post(
    '/tenant/wallet/load',
    { targetUserId: playerId, amount, notes: 'e2e funding' },
    { headers: { 'Idempotency-Key': k('e2e-load') } },
  );
}

export async function ensurePaymentMethod(api: ApiClient): Promise<{ id: string }> {
  // Intentamos listar; si ya existe uno activo lo reusamos.
  const list = await api.get<{ data: Array<{ id: string; isActive: boolean }> }>(
    '/tenant/payment-methods?activeOnly=true',
  );
  if (list.data.length > 0) return { id: list.data[0]!.id };
  const created = await api.post<{ id: string }>('/tenant/payment-methods', {
    code: 'e2e_method',
    name: 'E2E Method',
    type: 'bank_transfer',
    config: { cbu: '0000000000000000000000', alias: 'e2e.alias' },
  });
  return { id: created.id };
}
