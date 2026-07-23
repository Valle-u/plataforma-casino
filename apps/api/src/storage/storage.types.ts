/**
 * Tipos compartidos del subsistema de storage (Sprint 51.6).
 */

export interface UploadParams {
  /** Buffer del archivo (multer in-memory). */
  buffer: Buffer;
  /** Nombre original que subió el cliente (para preservar extensión). */
  originalName: string;
  /** MIME type detectado por multer. */
  mimeType: string;
  /**
   * Prefijo del key para organizar el bucket por feature.
   * Ej: `deposits/proofs`, `bonuses/banners`, etc.
   */
  keyPrefix: string;
  /**
   * Tenant slug — los archivos se aíslan por tenant en el bucket para
   * que un tenant no acceda a archivos de otro. Key final:
   * `tenants/<slug>/<keyPrefix>/<uuid>.<ext>`.
   */
  tenantSlug: string;
}

export interface UploadResult {
  /** Key opaca usada para retrieve/delete posteriores. */
  storageKey: string;
  /** URL pública (o signed) que el cliente puede usar para mostrar. */
  url: string;
  /** Tamaño del archivo en bytes (registrado para auditoría). */
  sizeBytes: number;
}

/**
 * Driver de storage — implementaciones: LocalDiskDriver (dev),
 * R2Driver (prod). Selección via env STORAGE_DRIVER.
 */
export interface StorageDriver {
  /** Sube un archivo y devuelve `{ storageKey, url, sizeBytes }`. */
  upload(params: UploadParams): Promise<UploadResult>;

  /**
   * Genera una URL pública (o signed para drivers con bucket privado)
   * a partir del storageKey persistido. Si el bucket es público, la
   * URL es estable; si es privado, vence en `ttlSeconds` (default 1h).
   */
  getUrl(storageKey: string, ttlSeconds?: number): Promise<string>;

  /**
   * Genera una presigned PUT URL para subir directo al bucket.
   * Solo soportado por R2Driver. LocalDiskDriver lanza error.
   */
  presignPutUrl?(storageKey: string, contentType: string, ttlSeconds?: number): Promise<string>;

  /**
   * Borra un archivo. Idempotente — si no existe, no falla.
   * Pensado para limpieza de comprobantes rechazados / reemplazos.
   */
  delete(storageKey: string): Promise<void>;
}
