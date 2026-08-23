/**
 * Tipos compartidos del CRM/livechat (backend). Ver docs/22-crm-livechat.md §4.
 */

/**
 * Adjunto de un mensaje. Se sube por HTTP (`POST /tenant/chat/upload`) y viaja
 * en el mensaje por WS. En la DB (`crm_messages.attachments`) guardamos SIN la
 * `url` (se rehidrata con `storage.getUrl(storageKey)` al leer, porque las URLs
 * firmadas de R2 vencen). El `storageKey` tiene el formato
 * `tenants/<slug>/chat/attachments/<uuid>.<ext>` → sirve para validar que el
 * adjunto pertenece al tenant (anti cross-tenant).
 */
export interface ChatAttachment {
  storageKey: string;
  mime: string;
  sizeBytes: number;
  name: string;
  kind: 'image' | 'pdf';
  /** Presente en la respuesta del upload y al hidratar; NO se persiste. */
  url?: string;
}

/** MIME types aceptados para adjuntos del chat (imágenes + PDF). */
export const CHAT_ATTACHMENT_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'application/pdf',
]);

/** Límites de adjuntos por mensaje. */
export const CHAT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const CHAT_ATTACHMENT_MAX_COUNT = 5;
