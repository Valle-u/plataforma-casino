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

import { Injectable, Logger } from '@nestjs/common';
import { eq, or } from 'drizzle-orm';
import { gameProviders, games, type GameProvider } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { NotificationsService } from '../notifications/notifications.service';
import { GameProviderLogsService } from './game-provider-logs.service';
import { refreshStudios } from './refresh-studios';
import { ProviderBackendRegistry } from './providers/provider-backend.registry';
import type { IProviderBackend } from './providers/provider-backend.interface';

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
  private readonly logger = new Logger(GameProvidersService.name);
  /** code → timestamp de inicio del sync en curso (evita disparar dos a la vez). */
  private readonly syncingCodes = new Map<string, number>();
  /** Un sync que arrancó hace más de esto se considera muerto (se puede re-disparar). */
  private static readonly SYNC_STUCK_MS = 5 * 60 * 1000;

  constructor(
    private readonly registry: ProviderBackendRegistry,
    private readonly logs: GameProviderLogsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Arranca el sync en SEGUNDO PLANO y devuelve enseguida. El catálogo de un
   * aggregator puede tardar 1-2 min (llamadas por vendor con rate limit + miles
   * de juegos) y NO entra en el timeout del request → 502. El resultado se
   * persiste en la fila (lastSync*) cuando termina; el panel lo lee al refrescar.
   */
  startSync(db: TenantDb, code: string): Promise<{ started: boolean; alreadyRunning: boolean }> {
    this.backend(code); // valida el proveedor (404 si no existe)
    const now = Date.now();
    const startedAt = this.syncingCodes.get(code);
    // Solo bloquea si hay uno REALMENTE en curso (arrancado hace poco). Si el
    // anterior quedó colgado (>5 min), lo damos por muerto y re-disparamos.
    if (startedAt && now - startedAt < GameProvidersService.SYNC_STUCK_MS) {
      return Promise.resolve({ started: false, alreadyRunning: true });
    }
    this.syncingCodes.set(code, now);
    // Fire-and-forget: la API de Railway es un server persistente, así que el
    // trabajo sigue después de responder. Los errores se loguean/persisten en runSync.
    void this.runSync(db, code)
      .catch((err) => {
        this.logger.error(`Sync en background de ${code} falló: ${(err as Error).message}`);
      })
      .finally(() => {
        this.syncingCodes.delete(code);
      });
    return Promise.resolve({ started: true, alreadyRunning: false });
  }

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

  /** Backend del proveedor `code`, o 404 si no está registrado. */
  private backend(code: string): IProviderBackend {
    return this.registry.get(code);
  }

  /**
   * Devuelve la fila de `game_providers` para `code`, creándola si no existe
   * (idempotente, tolerante a carreras vía onConflictDoNothing).
   */
  private async getOrCreateRow(
    db: TenantDb,
    code: string,
  ): Promise<GameProvider> {
    const backend = this.backend(code);
    const existing = await db
      .select()
      .from(gameProviders)
      .where(eq(gameProviders.code, code))
      .limit(1);
    if (existing[0]) return existing[0];

    await db
      .insert(gameProviders)
      .values({ code, displayName: backend.displayName })
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
    // Cada backend sabe leer sus propias credenciales (Palace: palace.*).
    const cfg = await this.backend(row.code).readConfigView(db);

    return {
      code: row.code,
      displayName: row.displayName,
      isEnabled: row.isEnabled,
      maintenanceMode: row.maintenanceMode,
      commissionFeePct: row.commissionFeePct,
      configured: cfg.apiTokenSet,
      config: {
        apiUrl: cfg.apiUrl,
        defaultLang: cfg.defaultLang,
        apiTokenSet: cfg.apiTokenSet,
      },
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

  /** Lista todos los proveedores registrados con su vista. */
  async list(db: TenantDb): Promise<ProviderView[]> {
    const views: ProviderView[] = [];
    for (const backend of this.registry.list()) {
      const row = await this.getOrCreateRow(db, backend.code);
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
    const backend = this.backend(code);
    await this.getOrCreateRow(db, code);
    const start = Date.now();
    let ok = false;
    let error: string | null = null;
    let latencyMs: number | null = null;
    try {
      await backend.testConnection(db);
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
    const cfg = await this.backend(code).readConfigView(db);
    if (!cfg.apiTokenSet) return; // sin credenciales → no chequeamos.

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
    const backend = this.backend(code);
    await this.getOrCreateRow(db, code);
    try {
      const result = await backend.syncGames(db);
      // "El sync pisa todo": el estado vuelve al del proveedor, así que se
      // resetean los overrides manuales (oculto/deshabilitado) de sus juegos.
      // Decisión explícita del dueño; por eso el sync es MANUAL (lo dispara él).
      await db
        .update(games)
        .set({ isHidden: false, isDisabled: false, updatedAt: new Date() })
        .where(eq(games.providerCode, code));
      // Estudio de cada juego, para el filtro del lobby. Se recalcula sobre
      // el catálogo ENTERO y no solo el de este proveedor: la canonización
      // cruza proveedores (si no, Gregmorn daría `EGT` y Forever `Egt`, dos
      // chips para el mismo estudio). Best-effort — que falle no invalida un
      // sync que ya trajo bien el catálogo.
      try {
        const n = await refreshStudios(db);
        if (n > 0) this.logger.log(`Estudios recalculados: ${n} juegos.`);
      } catch (err) {
        this.logger.warn(
          `No se pudieron recalcular los estudios: ${(err as Error).message}`,
        );
      }
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
    const backend = this.backend(code);
    const row = await this.getOrCreateRow(db, code);
    const cfg = await backend.readConfigView(db);
    const checks: DiagnoseCheck[] = [];

    // 1. api_url configurada + válida.
    checks.push({
      key: 'api_url',
      label: 'URL de la API configurada',
      ok: !!cfg.apiUrl && cfg.apiUrl.startsWith('https://'),
      detail: cfg.apiUrl
        ? `URL: ${cfg.apiUrl}`
        : 'Falta la URL de la API (se usaría el default).',
    });

    // 2. api_token cargado.
    checks.push({
      key: 'api_token',
      label: 'Token de la API cargado',
      ok: cfg.apiTokenSet,
      detail: cfg.apiTokenSet ? 'Token presente.' : 'Falta el token de la API.',
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

    // 4. Última sincronización.
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

    // 5+. Chequeos específicos del proveedor (Palace: callback token + 24h).
    checks.push(...(await backend.diagnoseExtra(db)));

    return checks;
  }
}
