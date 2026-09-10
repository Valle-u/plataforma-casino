/**
 * Sube un adjunto del chat (imagen o PDF) por HTTP y devuelve el descriptor que
 * después viaja en el mensaje por WS. Reusa `apiUpload` (cookie + tenant header).
 * El backend valida el contenido real y lo guarda bajo el namespace del tenant.
 */

'use client';

import { apiUpload } from '@/lib/api-client';
import type { ChatAttachment } from './types';

/**
 * Lo que el selector de archivos ofrece: imágenes, PDF y **audio** (**3.5**).
 *
 * ⚠️ **Esto no autoriza nada.** `accept` es una sugerencia del navegador —el
 * usuario puede elegir "todos los archivos" igual, y un cliente que no sea este
 * ni lo mira—. Quien decide qué entra es el backend, por los **bytes** del
 * archivo (`detectRealType`). Acá sólo se evita ofrecer lo que se va a
 * rechazar.
 *
 * `audio/*` en vez de la lista exacta: los navegadores usan la extensión para
 * decidir qué habilitar, y una nota de voz puede llegar como `.ogg`, `.opus`,
 * `.m4a` o `.amr` según el teléfono. Con la lista cerrada, el archivo aparecía
 * en gris y el usuario concluía que no se puede — cuando el backend sí lo
 * acepta.
 */
export const CHAT_ATTACHMENT_ACCEPT =
  'image/jpeg,image/png,image/webp,image/avif,application/pdf,audio/*';
export const CHAT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const CHAT_ATTACHMENT_MAX_COUNT = 5;

export async function uploadChatAttachment(file: File): Promise<ChatAttachment> {
  const fd = new FormData();
  fd.append('file', file);
  return apiUpload<ChatAttachment>('/tenant/chat/upload', fd);
}

/** Formatea bytes a un texto corto (ej. "1.2 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
