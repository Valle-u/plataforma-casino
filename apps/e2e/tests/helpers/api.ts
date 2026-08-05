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
import { fundWalletByUserId } from './db';

// Sprint 44: `127.0.0.1` en vez de `localhost` para forzar IPv4. Node 20+
// resuelve `localhost` a `::1` por default — si la API solo escucha IPv4,
// los tests fallan con ECONNREFUSED. Override via env E2E_API_BASE_URL si
// el setup es otro (ej. host remoto).
const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000';
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

  async put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    const res = await this.ctx.put(path, {
      data: body ?? {},
      headers: this.buildHeaders(opts?.headers),
    });
    if (!res.ok()) {
      throw new Error(`PUT ${path} → ${res.status()} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  /**
   * POST sin parse — devuelve status + body raw. Útil cuando esperamos
   * un error específico (ej. 409) y queremos verificarlo sin que el
   * helper tire por defecto.
   */
  async postRaw(
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<{ status: number; body: unknown }> {
    const res = await this.ctx.post(path, {
      data: body ?? {},
      headers: this.buildHeaders(opts?.headers),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep raw string */
    }
    return { status: res.status(), body: parsed };
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
  return createTestUserWithRole(api, label, 'usuario_final');
}

/**
 * Crea un user con cualquier rol (admin_tenant/socio/distribuidor/cajero/
 * empleado/usuario_final). Usado por specs que necesitan armar pirámides
 * jerárquicas para testear comisiones, scope, etc.
 */
export async function createTestUserWithRole(
  api: ApiClient,
  label: string,
  roleCode: string,
): Promise<TestPlayer> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const username = `e2e_${label}_${suffix}`.toLowerCase().slice(0, 30);
  const password = `e2e-pwd-${label}-2026`;
  const res = await api.post<{ user: { id: string } }>('/tenant/users', {
    username,
    password,
    displayName: `E2E ${label}`,
    roleCode,
  });
  return { id: res.user.id, username, password };
}

/** Setea el parent de un user en user_hierarchy. Requiere users.change_hierarchy.
 *  `relationType` por default = 'subordinado' (libre, max 50 chars). */
export async function setUserParent(
  api: ApiClient,
  userId: string,
  parentUserId: string,
  relationType = 'subordinado',
): Promise<void> {
  await api.put(`/tenant/user-hierarchy/${userId}/parent`, {
    parentUserId,
    relationType,
  });
}

/**
 * Fondea la wallet del player directo por DB (el mint del admin se eliminó).
 * Ver `helpers/db.ts` — inserta wallet + tx 'mint' source 'test_funding'.
 */
export async function fundPlayer(
  playerId: string,
  amount: string,
): Promise<void> {
  await fundWalletByUserId(playerId, amount);
}

/**
 * Sprint 51.6: sube un comprobante dummy via multipart/form-data al
 * endpoint `/tenant/deposits/upload-proof`. Devuelve `{ receiptUrl,
 * receiptStorageKey }` para pasar al payload del `create deposit`.
 *
 * Usado por todos los specs que crean deposits — el comprobante es
 * ahora obligatorio (DTO `IsNotEmpty()`).
 */
export async function uploadDepositProof(
  api: ApiClient,
): Promise<{ receiptUrl: string; receiptStorageKey: string }> {
  // PNG mínimo válido (1x1 transparent) — el backend valida MIME, así
  // que necesitamos un blob real. Hex del archivo PNG válido.
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
  // playwright APIRequestContext acepta multipart via `multipart` option.
  // Como nuestro ApiClient wrapper no lo expone, usamos `post` con un
  // FormData simulado a mano via fetch directo del ctx interno. Lo más
  // simple: usar el ctx directamente.
  const baseURL = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000';
  const token = (api as unknown as { token: string | null }).token;
  const tenantHost = process.env.E2E_TENANT_HOST ?? 'demo.localhost';
  const res = await fetch(`${baseURL}/tenant/deposits/upload-proof`, {
    method: 'POST',
    headers: {
      'X-Tenant-Host': tenantHost,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: (() => {
      const fd = new FormData();
      fd.append(
        'file',
        new Blob([new Uint8Array(pngBytes)], { type: 'image/png' }),
        'proof.png',
      );
      return fd;
    })(),
  });
  if (!res.ok) {
    throw new Error(`upload-proof falló ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    receiptUrl: string;
    receiptStorageKey: string;
  };
  return {
    receiptUrl: json.receiptUrl,
    receiptStorageKey: json.receiptStorageKey,
  };
}

/**
 * Sprint 52: sube un comprobante dummy via multipart/form-data al endpoint
 * `/tenant/bank-transactions/upload-proof`. Devuelve `{ receiptUrl,
 * receiptStorageKey }` para pasar al payload de una bank_tx saliente (o
 * al pay-in-full). El mismo `receiptStorageKey` no puede reutilizarse.
 */
export async function uploadBankTxProof(
  api: ApiClient,
): Promise<{ receiptUrl: string; receiptStorageKey: string }> {
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
  const baseURL = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000';
  const token = (api as unknown as { token: string | null }).token;
  const tenantHost = process.env.E2E_TENANT_HOST ?? 'demo.localhost';
  const res = await fetch(`${baseURL}/tenant/bank-transactions/upload-proof`, {
    method: 'POST',
    headers: {
      'X-Tenant-Host': tenantHost,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: (() => {
      const fd = new FormData();
      fd.append(
        'file',
        new Blob([new Uint8Array(pngBytes)], { type: 'image/png' }),
        'proof.png',
      );
      return fd;
    })(),
  });
  if (!res.ok) {
    throw new Error(
      `bank-tx upload-proof falló ${res.status}: ${await res.text()}`,
    );
  }
  const json = (await res.json()) as {
    receiptUrl: string;
    receiptStorageKey: string;
  };
  return {
    receiptUrl: json.receiptUrl,
    receiptStorageKey: json.receiptStorageKey,
  };
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
