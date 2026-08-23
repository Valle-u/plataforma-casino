/**
 * Cliente HTTP del "CRM" del contacto (contexto + notas + tags) para la bandeja
 * del operador. Reusa apiGet/apiPost/apiDelete (cookie + tenant header). Todos
 * los endpoints están detrás del flag CRM_ENABLED + @PanelOnly en el backend.
 */

'use client';

import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import type { ContactContext, CrmNote, CrmTag } from './types';

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
