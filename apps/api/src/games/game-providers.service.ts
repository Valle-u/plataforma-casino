/**
 * GameProvidersService — estado operacional + config + salud de los
 * proveedores de juegos del tenant (sección "Game Providers").
 *
 * Responsabilidades:
 *   - CRUD del estado en `game_providers` (habilitado, mantenimiento, y el
 *     resultado del último sync + ping).
 *   - Vista unificada que mergea el estado con las credenciales que viven en
 *     `tenant_settings` (palace.api_url / api_token / default_lang) — el token
 *     se devuelve enmascarado (solo "configurado sí/no").
 *   - Healthcheck/ping al proveedor (via PalaceClient.agentInfo).
 *   - Sync manual (via PalaceSyncService) persistiendo el resultado.
 *   - Diagnóstico: batería de chequeos pass/fail.
 *
 * NO toca las credenciales del cliente/callback que mueve fichas: la escritura
 * de credenciales la hace el front vía el endpoint validado
 * `PATCH /tenant/settings/:key`. Acá solo LEEMOS settings para la vista.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, or, sql } from 'drizzle-orm';
import {
  gameProviders,
  games,
  palaceTransactions,
  type GameProvider,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GameProviderLogsService } from './game-provider-logs.service';
import { PalaceClient } from './providers/palace/palace-client';
import { PalaceSyncService } from './providers/palace/palace-sync.service';

/** Proveedores conocidos por la plataforma. MVP: solo Palace. */
const KNOWN_PROVIDERS: Record<string, { displayName: string }> = {
  palace: { displayName: 'Palace Casino' },
};

export interface ProviderView {
  code: string;
  displayName: string;
  isEnabled: boolean;
  maintenanceMode: boolean;
  /** Comisión que el proveedor nos cobra sobre el NetWin (ej. '7.00'). */
  commissionFeePct: string;
  /** ¿Tiene credenciales mínimas cargadas (api_token)? */
  configured: boolean;
  config: {
    apiUrl: string | null;
    defaultLang: number | null;
    apiTokenSet: boolean;
  };
  lastSyncAt: Date | null;
  lastSyncOk: boolean | null;
  lastSyncResult: unknown;
  lastPingAt: Date | null;
  lastPingOk: boolean | null;
  lastPingLatencyMs: number | null;
}

export interface PingResult {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface DiagnoseCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

@Injectable()
export class GameProvidersService {
  constructor(
    private readonly settings: TenantSettingsService,
    private readonly palaceClient: PalaceClient,
    private readonly palaceSync: PalaceSyncService,
    private readonly logs: GameProviderLogsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Alerta in-app a los admins del tenant. Best-effort (nunca tira). */
  private async alertAdmins(
    db: TenantDb,
    title: string,
    message: string,
    providerCode: string,
  ): Promise<void> {
    try {
      await this.notifications.enqueueForRole(db, {
        roleCode: 'admin_tenant',
        kind: 'game_provider_alert',
        channel: 'in_app',
        payload: { title, message, providerCode },
      });
    } catch {
      // no-op: una alerta que falla no debe romper el flujo.
    }
  }

  /** Valida que `code` sea un proveedor conocido; sino 404. */
  private assertKnown(code: string): { displayName: string } {
    const known = KNOWN_PROVIDERS[code];
    if (!known) {
      throw new NotFoundException(`Proveedor desconocido: ${code}`);
    }
    return known;
  }

  /**
   * Devuelve la fila de `game_providers` para `code`, creándola si no existe
   * (idempotente, tolerante a carreras vía onConflictDoNothing).
   */
  private async getOrCreateRow(
    db: TenantDb,
    code: string,
  ): Promise<GameProvider> {
    const known = this.assertKnown(code);
    const existing = await db
      .select()
      .from(gameProviders)
      .where(eq(gameProviders.code, code))
      .limit(1);
    if (existing[0]) return existing[0];

    await db
      .insert(gameProviders)
      .values({ code, displayName: known.displayName })
      .onConflictDoNothing({ target: gameProviders.code });

    const row = await db
      .select()
      .from(gameProviders)
      .where(eq(gameProviders.code, code))
      .limit(1);
    return row[0]!;
  }

  /** Mergea la fila con las credenciales de tenant_settings → vista de UI. */
  private async buildView(
    db: TenantDb,
    row: GameProvider,
  ): Promise<ProviderView> {
    // Solo Palace por ahora: las keys de credenciales son palace.*.
    const apiUrl =
      (await this.settings.get<string>(db, 'palace.api_url')) ?? null;
    const apiToken =
      (await this.settings.get<string>(db, 'palace.api_token')) ?? null;
    const defaultLang =
      (await this.settings.get<number>(db, 'palace.default_lang')) ?? null;
    const apiTokenSet = !!apiToken && apiToken.length > 0;

    return {
      code: row.code,
      displayName: row.displayName,
      isEnabled: row.isEnabled,
      maintenanceMode: row.maintenanceMode,
      commissionFeePct: row.commissionFeePct,
      configured: apiTokenSet,
      config: { apiUrl, defaultLang, apiTokenSet },
      lastSyncAt: row.lastSyncAt,
      lastSyncOk: row.lastSyncOk,
      lastSyncResult: row.lastSyncResult,
      lastPingAt: row.lastPingAt,
      lastPingOk: row.lastPingOk,
      lastPingLatencyMs: row.lastPingLatencyMs,
    };
  }

  /**
   * Códigos de proveedores NO operativos (deshabilitados o en mantenimiento).
   * Sus juegos se excluyen del lobby y no se pueden abrir. Barato (tabla chica).
   */
  async getBlockedProviderCodes(db: TenantDb): Promise<string[]> {
    const rows = await db
      .select({ code: gameProviders.code })
      .from(gameProviders)
      .where(
        or(
          eq(gameProviders.isEnabled, false),
          eq(gameProviders.maintenanceMode, true),
        ),
      );
    return rows.map((r) => r.code);
  }

  /** ¿El proveedor está operativo (habilitado y sin mantenimiento)? */
  async isProviderOperational(db: TenantDb, code: string): Promise<boolean> {
    const rows = await db
      .select({
        isEnabled: gameProviders.isEnabled,
        maintenanceMode: gameProviders.maintenanceMode,
      })
      .from(gameProviders)
      .where(eq(gameProviders.code, code))
      .limit(1);
    const row = rows[0];
    // Sin fila = proveedor no registrado → lo tratamos como operativo (la fila
    // se crea lazy; no bloqueamos por ausencia).
    if (!row) return true;
    return row.isEnabled && !row.maintenanceMode;
  }

  /** Lista todos los proveedores conocidos con su vista. */
  async list(db: TenantDb): Promise<ProviderView[]> {
    const views: ProviderView[] = [];
    for (const code of Object.keys(KNOWN_PROVIDERS)) {
      const row = await this.getOrCreateRow(db, code);
      views.push(await this.buildView(db, row));
    }
    return views;
  }

  /** Vista de un proveedor puntual. */
  async getOne(db: TenantDb, code: string): Promise<ProviderView> {
    const row = await this.getOrCreateRow(db, code);
    return this.buildView(db, row);
  }

  /** Actualiza flags operativos (habilitado / mantenimiento / fee del proveedor). */
  async updateFlags(
    db: TenantDb,
    code: string,
    patch: {
      isEnabled?: boolean;
      maintenanceMode?: boolean;
      commissionFeePct?: number;
    },
  ): Promise<ProviderView> {
    await this.getOrCreateRow(db, code);
    const set: Partial<GameProvider> = { updatedAt: new Date() };
    if (patch.isEnabled !== undefined) set.isEnabled = patch.isEnabled;
    if (patch.maintenanceMode !== undefined)
      set.maintenanceMode = patch.maintenanceMode;
    if (patch.commissionFeePct !== undefined)
      set.commissionFeePct = patch.commissionFeePct.toFixed(2);
    await db
      .update(gameProviders)
      .set(set)
      .where(eq(gameProviders.code, code));
    return this.getOne(db, code);
  }

  /**
   * Healthcheck: llama a un endpoint liviano autenticado del proveedor
   * (Palace: /v4/agent/info) y mide la latencia. Persiste el resultado.
   */
  async testConnection(db: TenantDb, code: string): Promise<PingResult> {
    this.assertKnown(code);
    await this.getOrCreateRow(db, code);
    const start = Date.now();
    let ok = false;
    let error: string | null = null;
    let latencyMs: number | null = null;
    try {
      await this.palaceClient.agentInfo(db);
      latencyMs = Date.now() - start;
      ok = true;
    } catch (err) {
      latencyMs = Date.now() - start;
      error = err instanceof Error ? err.message : String(err);
    }
    await db
      .update(gameProviders)
      .set({
        lastPingAt: new Date(),
        lastPingOk: ok,
        lastPingLatencyMs: latencyMs,
        updatedAt: new Date(),
      })
      .where(eq(gameProviders.code, code));
    return { ok, latencyMs, error };
  }

  /**
   * Ping para el cron periódico: solo pinguea si el proveedor está configurado
   * (evita ruido en tenants sin credenciales). Registra log + alerta al admin
   * SOLO en la transición de estado (online→offline y viceversa), para no
   * spamear cada 5 minutos.
   */
  async pingAndAlert(db: TenantDb, code: string): Promise<void> {
    const before = await this.getOrCreateRow(db, code);
    const wasOk = before.lastPingOk; // boolean | null (null = nunca)
    const token = await this.settings.get<string>(db, 'palace.api_token');
    if (!token) return; // sin credenciales → no chequeamos.

    const ping = await this.testConnection(db, code);
    if (!ping.ok && wasOk !== false) {
      // Transición a offline (o primer chequeo fallido).
      await this.logs.write(db, {
        providerCode: code,
        eventType: 'ping',
        severity: 'error',
        message: 'El proveedor dejó de responder (offline).',
        detail: { error: ping.error },
      });
      await this.alertAdmins(
        db,
        'Proveedor de juegos offline',
        `${code} no responde: ${ping.error ?? 'sin detalle'}.`,
        code,
      );
    } else if (ping.ok && wasOk === false) {
      // Volvió online.
      await this.logs.write(db, {
        providerCode: code,
        eventType: 'ping',
        severity: 'info',
        message: 'El proveedor volvió a responder (online).',
        detail: { latencyMs: ping.latencyMs },
      });
    }
  }

  /**
   * Sync manual del catálogo. Persiste el resultado (o el error) en la fila
   * para mostrarlo en "última sincronización".
   */
  async runSync(db: TenantDb, code: string): Promise<unknown> {
    this.assertKnown(code);
    await this.getOrCreateRow(db, code);
    try {
      const result = await this.palaceSync.syncGames(db);
      // "El sync pisa todo": el estado vuelve al del proveedor, así que se
      // resetean los overrides manuales (oculto/deshabilitado) de sus juegos.
      // Decisión explícita del dueño; por eso el sync es MANUAL (lo dispara él).
      await db
        .update(games)
        .set({ isHidden: false, isDisabled: false, updatedAt: new Date() })
        .where(eq(games.providerCode, code));
      await db
        .update(gameProviders)
        .set({
          lastSyncAt: new Date(),
          lastSyncOk: true,
          lastSyncResult: result,
          updatedAt: new Date(),
        })
        .where(eq(gameProviders.code, code));
      await this.logs.write(db, {
        providerCode: code,
        eventType: 'catalog_change',
        severity: 'info',
        message: 'Sincronización de catálogo completada.',
        detail: { ...result },
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(gameProviders)
        .set({
          lastSyncAt: new Date(),
          lastSyncOk: false,
          lastSyncResult: { error: message },
          updatedAt: new Date(),
        })
        .where(eq(gameProviders.code, code));
      await this.logs.write(db, {
        providerCode: code,
        eventType: 'sync_error',
        severity: 'error',
        message: 'Falló la sincronización del catálogo.',
        detail: { error: message },
      });
      await this.alertAdmins(
        db,
        'Sync de catálogo falló',
        `No se pudo sincronizar el catálogo de ${code}: ${message}`,
        code,
      );
      throw err;
    }
  }

  /**
   * Diagnóstico: batería de chequeos pass/fail sobre la config y la salud
   * del proveedor. No modifica nada (salvo el lastPing que actualiza el
   * chequeo de conexión).
   */
  async diagnose(db: TenantDb, code: string): Promise<DiagnoseCheck[]> {
    this.assertKnown(code);
    const row = await this.getOrCreateRow(db, code);
    const checks: DiagnoseCheck[] = [];

    // 1. api_url configurada + válida.
    const apiUrl = await this.settings.get<string>(db, 'palace.api_url');
    checks.push({
      key: 'api_url',
      label: 'URL de la API configurada',
      ok: !!apiUrl && apiUrl.startsWith('https://'),
      detail: apiUrl
        ? `URL: ${apiUrl}`
        : 'Falta palace.api_url (se usaría el default).',
    });

    // 2. api_token cargado.
    const apiToken = await this.settings.get<string>(db, 'palace.api_token');
    checks.push({
      key: 'api_token',
      label: 'Token de la API cargado',
      ok: !!apiToken && apiToken.length > 0,
      detail: apiToken ? 'Token presente.' : 'Falta palace.api_token.',
    });

    // 3. Conexión + auth (llamada real). Reusa testConnection (persiste ping).
    const ping = await this.testConnection(db, code);
    checks.push({
      key: 'connection',
      label: 'Conexión y autenticación con el proveedor',
      ok: ping.ok,
      detail: ping.ok
        ? `Respondió OK en ${ping.latencyMs} ms.`
        : `Falló: ${ping.error ?? 'error desconocido'}`,
    });

    // 4. Callback token (env var del server).
    const callbackToken = process.env.PALACE_CALLBACK_TOKEN;
    checks.push({
      key: 'callback_token',
      label: 'Callback token del server configurado',
      ok: !!callbackToken && callbackToken.length > 0,
      detail: callbackToken
        ? 'PALACE_CALLBACK_TOKEN seteado.'
        : 'Falta la env var PALACE_CALLBACK_TOKEN (los callbacks se rechazan).',
    });

    // 5. Última sincronización.
    checks.push({
      key: 'last_sync',
      label: 'Última sincronización del catálogo',
      ok: row.lastSyncOk === true,
      detail:
        row.lastSyncAt == null
          ? 'Nunca se sincronizó. Corré "Sincronizar".'
          : row.lastSyncOk
            ? `OK el ${row.lastSyncAt.toISOString()}.`
            : `Con error el ${row.lastSyncAt.toISOString()}.`,
    });

    // 6. Callbacks recibidos en las últimas 24h.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(palaceTransactions)
      .where(
        and(
          eq(palaceTransactions.status, 'OK'),
          gte(palaceTransactions.createdAt, since),
        ),
      );
    const recentCount = recent[0]?.total ?? 0;
    checks.push({
      key: 'recent_callbacks',
      label: 'Actividad de callbacks (24h)',
      ok: true, // informativo, no falla
      detail: `${recentCount} callbacks OK en las últimas 24h.`,
    });

    return checks;
  }
}
