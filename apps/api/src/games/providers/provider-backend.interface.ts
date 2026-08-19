/**
 * `IProviderBackend` — contrato de gestión/operación de UN proveedor de juegos,
 * usado por `GameProvidersService` (sección "Game Providers" del panel).
 *
 * OJO — no confundir con `IGameProvider` (game-provider.interface.ts): ese es el
 * contrato del CICLO DE JUEGO (launch/settle/rollback). Éste es el contrato de
 * ADMINISTRACIÓN del proveedor (leer config, testear conexión, sincronizar
 * catálogo, diagnosticar). Un proveedor implementa ambos.
 *
 * Objetivo (F0, generalización multi-proveedor): sacar lo hardcodeado a Palace de
 * `GameProvidersService`. Cada proveedor aporta su backend; el service resuelve
 * por `provider_code` vía `ProviderBackendRegistry`. Agregar un 2º proveedor
 * (Forever) = implementar este contrato + registrarlo, sin tocar el service.
 */

import type { TenantDb } from '../../tenant-resolver/tenant-context';

/** Vista de credenciales/config del proveedor para el panel (token enmascarado). */
export interface ProviderConfigView {
  /** URL base de la API del proveedor (o null si no está configurada). */
  apiUrl: string | null;
  /** Idioma default, si el proveedor lo usa (Palace sí; otros pueden no). */
  defaultLang: number | null;
  /** ¿Tiene el token/credencial mínima cargada? (no expone el valor). */
  apiTokenSet: boolean;
}

/** Chequeo pass/fail del diagnóstico del proveedor. */
export interface ProviderDiagnoseCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface IProviderBackend {
  /** Identificador del adapter — espeja `game_providers.code` / `games.provider_code`. */
  readonly code: string;

  /** Nombre visible en el panel (ej. 'Palace Casino'). */
  readonly displayName: string;

  /**
   * Lee las credenciales/config del proveedor desde `tenant_settings` y las
   * devuelve para la vista del panel (con el token enmascarado a booleano).
   */
  readConfigView(db: TenantDb): Promise<ProviderConfigView>;

  /**
   * Healthcheck: llama a un endpoint liviano autenticado del proveedor y
   * **lanza** si falla (el caller mide latencia y persiste el resultado).
   */
  testConnection(db: TenantDb): Promise<void>;

  /**
   * Sincroniza el catálogo (proveedores + juegos) del proveedor hacia la tabla
   * `games`. Devuelve el resumen del sync ({ fetched, created, updated, ... }).
   */
  syncGames(db: TenantDb): Promise<Record<string, unknown>>;

  /**
   * Chequeos de diagnóstico ESPECÍFICOS del proveedor (además de los genéricos
   * que arma el service: url/token/conexión/último-sync). Ej. Palace: callback
   * token del server + actividad reciente de callbacks.
   */
  diagnoseExtra(db: TenantDb): Promise<ProviderDiagnoseCheck[]>;
}
