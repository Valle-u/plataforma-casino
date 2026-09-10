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
   * Borra un archivo. Idempotente — si no existe, cuenta como borrado.
   *
   * **Nunca tira.** Un fallo de limpieza no puede voltear la operación que la
   * disparó: cuando se rechaza un depósito, lo que importa ya pasó y hacerlo
   * fallar entero cambiaría un problema de housekeeping por uno de negocio.
   *
   * ## ⚠️ Devuelve si el archivo YA NO ESTÁ, y eso no es decorativo
   *
   * `true` = no está más (se borró, o nunca existió). `false` = **sigue ahí**.
   *
   * Hasta la retención de adjuntos (**D15**, 4.1) los tres drivers se tragaban
   * el fallo y devolvían `void`, así que el que llamaba **no tenía forma de
   * saber si el archivo se había borrado**. Para limpiar un comprobante
   * rechazado alcanzaba; para un proceso de retención no: marcaría en la base
   * que una foto de DNI se borró mientras el archivo sigue en el bucket, y esa
   * mentira no la descubre nadie porque el registro dice que está todo bien.
   */
  delete(storageKey: string): Promise<boolean>;
}
