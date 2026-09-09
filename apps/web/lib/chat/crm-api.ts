/**
 * Cliente HTTP del "CRM" del contacto (contexto + notas + tags) para la bandeja
 * del operador. Reusa apiGet/apiPost/apiDelete (cookie + tenant header). Todos
 * los endpoints están detrás del flag CRM_ENABLED + @PanelOnly en el backend.
 */

'use client';

import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import type { ContactContext, CrmNote, CrmTag, CrmTemplate } from './types';

export const getContactContext = (contactId: string) =>
  apiGet<ContactContext>(`/tenant/chat/contacts/${contactId}/context`);

export const listContactNotes = (contactId: string) =>
  apiGet<CrmNote[]>(`/tenant/chat/contacts/${contactId}/notes`);

export const addContactNote = (contactId: string, body: string) =>
  apiPost<CrmNote>(`/tenant/chat/contacts/${contactId}/notes`, { body });

export const listTagCatalog = () => apiGet<CrmTag[]>(`/tenant/chat/tags`);

export const createTag = (label: string, color?: string | null) =>
  apiPost<CrmTag>(`/tenant/chat/tags`, { label, color });

export const listContactTags = (contactId: string) =>
  apiGet<CrmTag[]>(`/tenant/chat/contacts/${contactId}/tags`);

export const assignContactTag = (contactId: string, tagId: string) =>
  apiPost<{ ok: boolean }>(`/tenant/chat/contacts/${contactId}/tags`, { tagId });

export const unassignContactTag = (contactId: string, tagId: string) =>
  apiDelete<{ ok: boolean }>(
    `/tenant/chat/contacts/${contactId}/tags/${tagId}`,
  );

// ── Plantillas (respuestas rápidas por tenant) ──────────────────────────────

export const listTemplates = () =>
  apiGet<CrmTemplate[]>(`/tenant/chat/templates`);

export const createTemplate = (
  title: string,
  body: string,
  shortcut?: string | null,
) => apiPost<CrmTemplate>(`/tenant/chat/templates`, { title, body, shortcut });

export const deleteTemplate = (id: string) =>
  apiDelete<{ ok: boolean }>(`/tenant/chat/templates/${id}`);

// ── Canales externos (etapa 2) ───────────────────────────────────────────────

/**
 * Un canal, como lo ve la pantalla.
 *
 * ⚠️ **Nunca trae el token.** La API no lo devuelve en ninguna respuesta: se
 * guarda cifrado y no vuelve a salir (D20). `link` es lo que el operador le
 * pasa a sus jugadores.
 */
export interface CanalDeTelegram {
  id: string;
  type: string;
  username: string | null;
  link: string | null;
  isActive: boolean;
  esMio: boolean;
  createdAt: string | null;
}

export const listarCanalesDeTelegram = () =>
  apiGet<CanalDeTelegram[]>(`/tenant/chat/channels/telegram`);

export const vincularBotDeTelegram = (token: string) =>
  apiPost<CanalDeTelegram>(`/tenant/chat/channels/telegram`, { token });

export const desvincularCanalDeTelegram = (channelId: string) =>
  apiDelete<void>(`/tenant/chat/channels/telegram/${channelId}`);
