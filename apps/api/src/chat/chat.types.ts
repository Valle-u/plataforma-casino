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
  kind: 'image' | 'pdf' | 'audio';
  /** Presente en la respuesta del upload y al hidratar; NO se persiste. */
  url?: string;
}

/**
 * MIME types aceptados para adjuntos del chat: imágenes, PDF y **audio**.
 *
 * ## Por qué entró el audio y no el video (**3.5**)
 *
 * Decidido por el dueño el 2026-09-10. **Los mensajes de voz son cómo habla
 * media Argentina por WhatsApp**: sin eso, el operador no puede oír al cliente y
 * le tiene que pedir que lo escriba, que es fricción justo en el canal que vino
 * a sacarla. El video pesa entre 10 y 50 veces más y es raro en una conversación
 * de soporte.
 *
 * ⚠️ **Esta lista no es la que decide.** Acá se valida lo que ya se subió; el
 * que decide qué entra es `detectRealType()`, por los bytes. Y ahí está la parte
 * que importa: OGG y MP4 **también llevan video**, así que se mira el códec de
 * adentro. Sin eso "video no" sería cierto en los docs y falso en el código.
 *
 * Los audios caen bajo **D15** como cualquier adjunto: se borran a los 6 meses.
 */
export const CHAT_ATTACHMENT_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'application/pdf',
  // Notas de voz de WhatsApp y de Telegram: las dos plataformas mandan OGG/opus.
  'audio/ogg',
  'audio/mpeg',
  // Memos de voz de iPhone.
  'audio/mp4',
  // WhatsApp en Android viejo.
  'audio/amr',
]);

/**
 * De qué tipo es un adjunto, a partir de su MIME.
 *
 * Existe porque esto estaba escrito **dos veces** como
 * `mime === 'application/pdf' ? 'pdf' : 'image'` —en el upload y al persistir el
 * mensaje— y las dos copias eran correctas sólo mientras no hubiera un tercer
 * tipo. Con audio, las dos habrían etiquetado **toda nota de voz como imagen**, y
 * la burbuja habría intentado dibujar un `<img>` con un `.ogg` adentro.
 *
 * ⚠️ Asume que el MIME **ya pasó** por `CHAT_ATTACHMENT_MIMES`. No es un
 * validador: es la traducción de un valor que ya se validó.
 */
export function kindDelMime(mime: string): ChatAttachment['kind'] {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  return 'image';
}

/** Límites de adjuntos por mensaje. */
export const CHAT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const CHAT_ATTACHMENT_MAX_COUNT = 5;
