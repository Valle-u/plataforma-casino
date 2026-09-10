/**
 * Cliente HTTP del "CRM" del contacto (contexto + notas + tags) para la bandeja
 * del operador. Reusa apiGet/apiPost/apiDelete (cookie + tenant header). Todos
 * los endpoints están detrás del flag CRM_ENABLED + @PanelOnly en el backend.
 */

'use client';

import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { ContactContext, CrmNote, CrmTag, CrmTemplate } from './types';
import type { EtapaDelCircuito } from '@/lib/crm/etapas';

export const getContactContext = (contactId: string) =>
  apiGet<ContactContext>(`/tenant/chat/contacts/${contactId}/context`);

export const listContactNotes = (contactId: string) =>
  apiGet<CrmNote[]>(`/tenant/chat/contacts/${contactId}/notes`);

export const addContactNote = (contactId: string, body: string) =>
  apiPost<CrmNote>(`/tenant/chat/contacts/${contactId}/notes`, { body });

export const listTagCatalog = () => apiGet<CrmTag[]>(`/tenant/chat/tags`);

/**
 * El catálogo con **cuántos contactos usa cada etiqueta**, para Configuración.
 *
 * Va aparte del catálogo simple a propósito: el selector de la ficha no
 * necesita el conteo, y pedirlo ahí sería un `count` por etiqueta cada vez que
 * se abre un contacto.
 */
export const listarCatalogoDeEtiquetas = () =>
  apiGet<EtiquetaConUso[]>(`/tenant/chat/tags/catalogo`);

export interface EtiquetaConUso {
  id: string;
  label: string;
  color: string | null;
  /** Cuántos contactos la tienen puesta. */
  uso: number;
}

/** Renombrar o recolorear. Pide `tenant.settings.edit`. */
export const editarEtiqueta = (
  tagId: string,
  cambios: { label?: string; color?: string | null },
) => apiPatch<CrmTag>(`/tenant/chat/tags/${tagId}`, cambios);

/**
 * Borrar una etiqueta del catálogo.
 *
 * ⚠️ **La saca de todos los contactos que la tenían** y no se puede deshacer.
 */
export const borrarEtiqueta = (tagId: string) =>
  apiDelete<void>(`/tenant/chat/tags/${tagId}`);

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

/**
 * Los contactos de la bandeja, paginados (sección **Contactos**).
 *
 * Trae exactamente los mismos que se pueden abrir: los que tienen alguna
 * conversación asignada a esta bandeja. Una lista más ancha sería una pantalla
 * que enumera gente a la que después el backend no te deja entrar.
 */
export const listarContactos = (params: { search?: string; page?: number }) => {
  const qs = new URLSearchParams();
  if (params.search?.trim()) qs.set('search', params.search.trim());
  if (params.page && params.page > 1) qs.set('page', String(params.page));
  const cola = qs.toString();
  return apiGet<PaginaDeContactos>(
    `/tenant/chat/contacts${cola ? `?${cola}` : ''}`,
  );
};

export interface ContactoDeBandeja {
  id: string;
  displayName: string | null;
  userId: string | null;
  isLead: boolean;
  phone: string | null;
  username: string | null;
  userDisplayName: string | null;
  lastMessageAt: string | null;
  sinLeer: number;
  /** La conversación más reciente: la que abre el botón "Abrir". */
  conversationId: string;
  channelType: string;
  tags: Array<{ id: string; label: string; color: string | null }>;
}

export interface PaginaDeContactos {
  items: ContactoDeBandeja[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Acciones sobre la conversación ─────────────────────────────────────────
//
// ⚠️ Estos tres endpoints existen desde la **etapa 1** (1.4, 1.5 y 1.6),
// probados, y **hasta la ficha del CRM no los llamaba nadie**. El roadmap los
// daba por hechos porque el backend estaba; del lado del operador no había
// ningún botón que los disparara.

/**
 * Cerrar, marcar pendiente o reabrir (**1.4**).
 *
 * Un 404 significa "no existe **o** no es de tu bandeja", los dos casos
 * juntos a propósito: un 403 le confirmaría a alguien que esa conversación
 * existe en otra bandeja.
 */
export const cambiarEstadoDeConversacion = (
  conversationId: string,
  status: 'open' | 'pending' | 'resolved',
) =>
  apiPost<{ id: string; status: string }>(
    `/tenant/chat/conversations/${conversationId}/status`,
    { status },
  );

/**
 * Avisarle al operador del jugador que escribió acá (**1.5**, **D8**).
 *
 * **No transfiere la conversación.** A la otra bandeja le llega quién escribió
 * y cuándo — nunca el contenido del chat. Esa garantía está del lado del
 * backend, en la firma de `textoDelAviso`.
 */
export const avisarAlOperador = (contactId: string) =>
  apiPost<{ ok: boolean; operatorId?: string }>(
    `/tenant/chat/contacts/${contactId}/notify-operator`,
  );

/**
 * Alta de jugador desde el chat (**1.6**, **D9**).
 *
 * **No se le pasa de quién cuelga**: sale de la bandeja por la que esa persona
 * escribió. Con un desplegable, un alta podría terminar colgada de quien
 * convenga y no de quien atendió — y eso es plata.
 */
export const crearJugadorDesdeElChat = (
  contactId: string,
  datos: { username: string; displayName?: string },
) =>
  apiPost<AltaDesdeElChat>(
    `/tenant/chat/contacts/${contactId}/create-player`,
    datos,
  );

/**
 * Lo que devuelve el alta.
 *
 * ⚠️ **La contraseña viene una sola vez.** Se genera en el servidor y no se
 * guarda en claro: si esta respuesta se pierde, no hay forma de recuperarla y
 * hay que resetearla. Por eso la pantalla la muestra hasta que el operador
 * confirme que la copió, y no la pide de nuevo.
 *
 * `generatedPassword` viene sólo cuando la generó el servidor. Si el operador
 * mandó una, no vuelve — ya la sabe.
 */
export interface AltaDesdeElChat {
  userId: string;
  username: string;
  generatedPassword?: string;
}

/**
 * Jugadores que ya tienen el teléfono de este contacto (**el freno del alta**).
 *
 * `users.phone` **no es único**: sin este chequeo, dar de alta a alguien que ya
 * tiene cuenta crea una segunda con el saldo partido, y las cuentas no se
 * fusionan. El operador no tiene cómo saberlo mirando una conversación.
 *
 * La lista viene acotada por red (R6): sólo jugadores que el que pregunta ya
 * podría ver. Y sin saldo — para decidir si es la misma persona no hace falta.
 */
export const homonimosDelContacto = (contactId: string) =>
  apiGet<JugadorHomonimo[]>(
    `/tenant/chat/contacts/${contactId}/homonimos`,
  );

export interface JugadorHomonimo {
  id: string;
  username: string;
  displayName: string | null;
  status: string;
}

// ── Plantillas (respuestas rápidas por tenant) ──────────────────────────────

export const listTemplates = () =>
  apiGet<CrmTemplate[]>(`/tenant/chat/templates`);

export const createTemplate = (
  title: string,
  body: string,
  shortcut?: string | null,
) => apiPost<CrmTemplate>(`/tenant/chat/templates`, { title, body, shortcut });

/**
 * Editar una plantilla. Pide `tenant.settings.edit`.
 *
 * El catálogo es de **todo el tenant**: lo que edita uno lo ven todos.
 */
export const editarPlantilla = (
  id: string,
  cambios: { title?: string; body?: string; shortcut?: string | null },
) => apiPatch<CrmTemplate>(`/tenant/chat/templates/${id}`, cambios);

/**
 * Borrar una plantilla.
 *
 * ⚠️ Ahora pide `tenant.settings.edit`. **Antes no pedía nada**: cualquier
 * operador con acceso al CRM podía borrar una plantilla que usaba todo el
 * casino.
 */
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

// ── Circuitos ────────────────────────────────────────────────────────────────
//
// La etapa **se calcula al mirar**: sale de si el contacto tiene cuenta, si
// depositó y cuándo jugó por última vez. No hay ninguna columna `etapa` que
// alguien tenga que mantener, y por eso no se puede desincronizar.
//
// Las etapas son **excluyentes**: los cinco números suman el total de contactos
// de la bandeja. Es una distribución —dónde está cada uno hoy—, no un embudo
// acumulado ni una historia de por dónde pasó.

/** Cuántos hay en cada etapa. Siempre las cinco claves, aunque estén en cero. */
export const contarEtapas = () =>
  apiGet<Record<EtapaDelCircuito, number>>(`/tenant/chat/circuitos`);

/**
 * Quiénes están en una etapa, para poder abrirlos.
 *
 * Trae menos que `listarContactos` a propósito: sin etiquetas y sin sin-leer.
 * Acá la pregunta es "a quién le escribo", y ninguna de las dos la cambia.
 */
export const contactosDeLaEtapa = (etapa: EtapaDelCircuito, page = 1) =>
  apiGet<PaginaDeEtapa>(
    `/tenant/chat/circuitos/${etapa}${page > 1 ? `?page=${page}` : ''}`,
  );

export interface ContactoEnEtapa {
  id: string;
  displayName: string | null;
  userId: string | null;
  phone: string | null;
  username: string | null;
  userDisplayName: string | null;
  lastMessageAt: string | null;
  /** La conversación más reciente: la que abre el botón "Abrir". */
  conversationId: string;
}

export interface PaginaDeEtapa {
  items: ContactoEnEtapa[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Métricas de atención ─────────────────────────────────────────────────────
//
// Todo se mide sobre **tramos**, no sobre conversaciones: por D11 el hilo es
// eterno —el que escribió en marzo y vuelve en septiembre es la misma
// conversación—, así que medir la conversación mide la antigüedad del cliente,
// no la atención. Un tramo va desde que alguien escribe estando la conversación
// resuelta hasta que se vuelve a marcar resuelta.
//
// ⚠️ La medición **arrancó con la migración 0115 y no hay backfill**. Lo
// anterior no existe: `midiendoDesde` dice desde cuándo hay algo, y la pantalla
// lo muestra para que una ventana de 30 días recién instalada no se lea como un
// mes flojo.

export const metricasDeAtencion = (dias: 7 | 30) =>
  apiGet<MetricasDeAtencion>(`/tenant/chat/metricas?dias=${dias}`);

export interface MetricasDeAtencion {
  /** Quién está esperando **ahora**. No depende de la ventana. */
  sinResponder: {
    total: number;
    /** De ésos, los que llevan más de 24 horas. */
    viejos: number;
    masViejo: string | null;
  };
  ventana: number;
  /** Tramos que **empezaron** dentro de la ventana. */
  tramos: number;
  respondidos: number;
  resueltos: number;
  /** Mediana —no promedio— de la espera hasta la primera respuesta, en segundos. */
  medianaRespuesta: number | null;
  /** Mediana de lo que tardó en resolverse, en segundos. */
  medianaResolucion: number | null;
  porCanal: Array<{ canal: string; total: number }>;
  /** El tramo más viejo de esta bandeja: desde cuándo hay algo medido. */
  midiendoDesde: string | null;
}
