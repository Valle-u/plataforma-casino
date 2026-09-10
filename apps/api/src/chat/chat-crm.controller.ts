/**
 * ChatCrmController — endpoints HTTP del "CRM" del contacto para la bandeja del
 * operador: contexto del jugador, notas y tags. Todo detrás de TenantJwtGuard +
 * @PanelOnly (solo operadores, no jugadores) + autorización por contacto en el
 * service. Vive bajo /tenant/chat, junto al ChatController. Ver docs/22 §4.2.
 *
 * Todo el módulo está detrás del flag CRM_ENABLED (default OFF).
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Query,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import {
  TenantJwtGuard,
  type RequestWithTenantUser,
} from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import {
  ChatCrmService,
  type EtapaDelCircuito,
} from './chat-crm.service';
import { ChatService } from './chat.service';
import { TelegramChannelsService } from './telegram/telegram-channels.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { CrmAccessGuard, type RequestWithCrmInbox } from './crm-access.guard';
import {
  CrmMetricasService,
  VENTANAS,
  type Ventana,
} from './crm-metricas.service';

type Operator = { id: string; username: string };

/** Las cinco etapas que el backend sabe calcular. Ver `cteDeEtapas`. */
const ETAPAS_VALIDAS = [
  'lead',
  'cuenta',
  'deposito',
  'jugando',
  'reactivacion',
] as const satisfies readonly EtapaDelCircuito[];

@Controller('tenant/chat')
@UseGuards(TenantJwtGuard, CrmAccessGuard)
@PanelOnly()
export class ChatCrmController {
  constructor(
    private readonly crm: ChatCrmService,
    // El ciclo de vida de la conversación (estado, no leídos) vive en
    // ChatService, junto al resto del hilo; el CRM es la ficha del contacto.
    private readonly chat: ChatService,
    private readonly telegramChannels: TelegramChannelsService,
    private readonly metricasDeAtencion: CrmMetricasService,
  ) {}

  private db(req: RequestWithTenantUser) {
    const db = req.tenantContext?.db;
    if (!db) throw new NotFoundException('Tenant no resuelto.');
    return db;
  }

  /**
   * La "bandeja" del operador (dueño de las conversaciones que puede ver),
   * resuelta por CrmAccessGuard: el admin principal para el staff central, o el
   * propio operador para la red independiente. Se usa para autorizar el acceso
   * al contacto. La red dependiente ya fue bloqueada por el guard.
   */
  private owner(req: RequestWithTenantUser): string {
    const ownerId = (req as RequestWithCrmInbox).crmInboxOwnerId;
    if (!ownerId) throw new ForbiddenException('No tenés acceso al soporte.');
    return ownerId;
  }

  // ── Contexto ──────────────────────────────────────────────────────────────
  @Get('contacts/:contactId/context')
  async getContext(
    @Req() req: RequestWithTenantUser,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ) {
    const db = this.db(req);
    const contact = await this.crm.assertAccess(db, contactId, this.owner(req));
    // El acceso al contacto se autoriza por la BANDEJA (`owner`), pero qué se
    // ve de la ficha se decide por QUIÉN pregunta: es su red la que define si
    // puede ver la plata (R6 / P1). Para el staff central son lo mismo; para un
    // empleado de un socio independiente, no.
    const solicitanteId = req.tenantUser?.id;
    if (!solicitanteId) throw new ForbiddenException('No tenés acceso al soporte.');
    return this.crm.getContext(db, contact, solicitanteId);
  }

  // ── Estado de la conversación ─────────────────────────────────────────────

  /**
   * Cerrar, marcar pendiente o reabrir.
   *
   * Los tres estados vivían en la tabla desde que se creó el livechat y **nada
   * los escribía**. Éste es el endpoint que faltaba.
   *
   * Reabrir a mano casi no hace falta: por **D11**, si la persona vuelve a
   * escribir el hilo se reabre solo. Está igual para el caso de resolver por
   * error.
   */
  @Post('conversations/:conversationId/status')
  @HttpCode(HttpStatus.OK)
  async setStatus(
    @Req() req: RequestWithTenantUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() body: { status?: unknown },
  ) {
    const status = body?.status;
    if (
      status !== 'open' &&
      status !== 'pending' &&
      status !== 'resolved'
    ) {
      throw new BadRequestException({
        message: 'El estado tiene que ser open, pending o resolved.',
        error: 'INVALID_STATUS',
      });
    }

    const conv = await this.chat.setConversationStatus(this.db(req), {
      conversationId,
      inboxOwnerId: this.owner(req),
      status,
    });
    // `null` = la conversación no existe o **no es de esta bandeja**. Se
    // responde 404 en los dos casos a propósito: un 403 le confirmaría a
    // alguien que esa conversación existe en otra bandeja.
    if (!conv) throw new NotFoundException('Conversación no encontrada.');
    return { id: conv.id, status: conv.status };
  }

  // ── Derivar = avisar (D8) ─────────────────────────────────────────────────

  /**
   * Le avisa al operador del jugador que escribió a esta bandeja.
   *
   * ⚠️ **No manda la conversación.** A la otra bandeja llega quién escribió y
   * cuándo, nada más. Ver `ChatCrmService.notifyDirectOperator`.
   */
  @Post('contacts/:contactId/notify-operator')
  @HttpCode(HttpStatus.CREATED)
  async notifyOperator(
    @Req() req: RequestWithTenantUser,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ) {
    const db = this.db(req);
    const inboxOwnerId = this.owner(req);
    const contact = await this.crm.assertAccess(db, contactId, inboxOwnerId);
    return this.crm.notifyDirectOperator(db, { contact, inboxOwnerId });
  }

  /**
   * Los contactos de esta bandeja, paginados (sección **Contactos**).
   *
   * Devuelve exactamente el mismo universo que deja pasar `assertAccess`: los
   * que tienen alguna conversación asignada acá. Una lista más ancha sería una
   * pantalla que enumera gente que después no se puede abrir.
   */
  @Get('contacts')
  async listContacts(
    @Req() req: RequestWithTenantUser,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ) {
    const limit = 50;
    // La página llega del cliente: se acota y se cae a 1 ante cualquier cosa
    // rara, en vez de mandarle a Postgres un OFFSET negativo o gigante.
    const pagina = Math.max(1, Math.min(Number(page) || 1, 10_000));
    const { items, total } = await this.crm.listInboxContacts(
      this.db(req),
      this.owner(req),
      { search, limit, offset: (pagina - 1) * limit },
    );
    return { items, total, page: pagina, pageSize: limit };
  }

  // ── Circuitos ─────────────────────────────────────────────────────────────

  /**
   * Cuánta gente hay en cada etapa (sección **Circuitos**).
   *
   * Mismo alcance que Contactos: sólo la bandeja de quien pregunta. Un conteo
   * global sería un número agregado de redes ajenas, que es exactamente lo que
   * **R6** no permite ni siquiera al admin.
   */
  @Get('circuitos')
  async circuitos(@Req() req: RequestWithTenantUser) {
    return this.crm.etapasDeLaBandeja(this.db(req), this.owner(req));
  }

  /**
   * Quiénes están en una etapa. Sin esto, Circuitos sería un cartel con números.
   *
   * La etapa llega del cliente y se valida contra la lista cerrada **antes** de
   * tocar la consulta: es el único parámetro de acá que entra a un `WHERE` sin
   * ser un UUID.
   */
  @Get('circuitos/:etapa')
  async contactosDeEtapa(
    @Req() req: RequestWithTenantUser,
    @Param('etapa') etapa: string,
    @Query('page') page?: string,
  ) {
    if (!(ETAPAS_VALIDAS as readonly string[]).includes(etapa)) {
      throw new BadRequestException('Etapa desconocida.');
    }
    const limit = 50;
    const pagina = Math.max(1, Math.min(Number(page) || 1, 10_000));
    const { items, total } = await this.crm.contactosDeLaEtapa(
      this.db(req),
      this.owner(req),
      etapa as EtapaDelCircuito,
      { limit, offset: (pagina - 1) * limit },
    );
    return { items, total, page: pagina, pageSize: limit };
  }

  // ── Métricas de atención ──────────────────────────────────────────────────

  /**
   * Cómo se está atendiendo, medido sobre **tramos** (sección **Métricas**).
   *
   * Acotado a la bandeja de quien pregunta, como todo el CRM. Un tablero con
   * todos los operadores es exactamente lo que **R6** prohíbe, y además sería
   * un ranking — que `docs/crm/10-metricas.md` descarta por su cuenta: el que
   * cierra rápido no es el que atiende mejor.
   */
  @Get('metricas')
  async metricas(
    @Req() req: RequestWithTenantUser,
    @Query('dias') dias?: string,
  ) {
    // La ventana entra a un `interval`: se valida contra la lista cerrada y no
    // se acepta un número cualquiera del cliente.
    const pedida = Number(dias);
    const ventana = (VENTANAS as readonly number[]).includes(pedida)
      ? (pedida as Ventana)
      : 30;
    return this.metricasDeAtencion.deLaBandeja(
      this.db(req),
      this.owner(req),
      ventana,
    );
  }

  // ── Alta de jugador desde el chat (D9) ────────────────────────────────────

  /**
   * Jugadores que ya tienen el teléfono de este contacto (**el freno del alta**).
   *
   * `users.phone` no es único: sin este chequeo, dar de alta a alguien que ya
   * tiene cuenta crea una segunda con el saldo partido, y las cuentas no se
   * fusionan.
   *
   * Pide `users.create` —el mismo permiso que el alta— porque sólo tiene
   * sentido para quien va a crear. Y la lista viene acotada por red (R6): sin
   * eso sería la forma más fácil de averiguar quién juega en la red de otro.
   */
  @Get('contacts/:contactId/homonimos')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.create')
  async homonimos(
    @Req() req: RequestWithTenantUser,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @CurrentTenantUser() actor: Operator,
  ) {
    const db = this.db(req);
    const contact = await this.crm.assertAccess(db, contactId, this.owner(req));
    return this.crm.jugadoresConEseTelefono(db, {
      telefono: contact.phone,
      solicitanteId: actor.id,
    });
  }

  /**
   * Crea un jugador a partir de un lead que escribió.
   *
   * **No recibe de quién cuelga**: sale de la bandeja por la que esa persona
   * escribió (**D9**). El campo es fijo por diseño — con un desplegable, un
   * alta podría terminar colgada de quien convenga y no de quien atendió, y eso
   * es plata.
   *
   * Usa `users.create`, el mismo permiso que el alta del panel.
   */
  @Post('contacts/:contactId/create-player')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.create')
  @HttpCode(HttpStatus.CREATED)
  async createPlayer(
    @Req() req: RequestWithTenantUser,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @CurrentTenantUser() actor: Operator,
    @Body() body: { username?: unknown; displayName?: unknown; password?: unknown },
  ) {
    const username =
      typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
    if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
      throw new BadRequestException({
        message:
          'El usuario tiene que tener entre 3 y 30 caracteres: letras, números, punto, guión o guión bajo.',
        error: 'INVALID_USERNAME',
      });
    }

    const db = this.db(req);
    const contact = await this.crm.assertAccess(db, contactId, this.owner(req));
    return this.crm.createPlayerFromChat(db, {
      contact,
      actorId: actor.id,
      username,
      displayName:
        typeof body?.displayName === 'string' && body.displayName.trim()
          ? body.displayName.trim()
          : undefined,
      password:
        typeof body?.password === 'string' && body.password
          ? body.password
          : undefined,
    });
  }

  // ── Canales de Telegram (2.1) ─────────────────────────────────────────────

  /**
   * Los canales de esta bandeja.
   *
   * Sólo los suyos: por **D1** los canales son de un panel, y un operador no
   * tiene por qué saber qué bots tiene otro.
   */
  @Get('channels/telegram')
  async listTelegramChannels(@Req() req: RequestWithTenantUser) {
    return this.telegramChannels.listar(this.db(req), this.owner(req));
  }

  /**
   * Vincula un bot de Telegram a esta bandeja.
   *
   * Lo hace el **operador**, no el admin (**D13**). El token se guarda
   * **cifrado** (**D20**) y no vuelve a salir nunca de la API.
   */
  @Post('channels/telegram')
  @HttpCode(HttpStatus.CREATED)
  async linkTelegramChannel(
    @Req() req: RequestWithTenantUser,
    @Body() body: { token?: unknown },
  ) {
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (!token) {
      throw new BadRequestException({
        message: 'Falta el token del bot.',
        error: 'TOKEN_REQUIRED',
      });
    }

    const tenantSlug = req.tenantContext?.tenant.slug;
    if (!tenantSlug) throw new NotFoundException('Tenant no resuelto.');

    return this.telegramChannels.vincular(this.db(req), {
      token,
      inboxOwnerId: this.owner(req),
      tenantSlug,
      baseApiPublica: this.baseApiPublica(req),
    });
  }

  /** Desvincula un bot: corta el webhook y desactiva el canal. */
  @Delete('channels/telegram/:channelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlinkTelegramChannel(
    @Req() req: RequestWithTenantUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ) {
    await this.telegramChannels.desvincular(this.db(req), {
      channelId,
      inboxOwnerId: this.owner(req),
    });
  }

  /**
   * El origen público de la API, respetando el proxy de Cloudflare.
   *
   * Sale del request y no de una variable de entorno, igual que la callback de
   * los proveedores de juego (`game-providers.controller.ts`): es una URL menos
   * que mantener, y no se puede desincronizar del dominio real.
   */
  private baseApiPublica(req: RequestWithTenantUser): string {
    const h = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
    const primero = (v: string | string[] | undefined): string =>
      (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim() ?? '';

    const proto = primero(h['x-forwarded-proto']) || 'https';
    const host = primero(h['x-forwarded-host']) || primero(h.host);
    if (!host) {
      throw new BadRequestException({
        message:
          'No se pudo determinar el host público de la API para registrar el webhook.',
        error: 'PUBLIC_HOST_UNKNOWN',
      });
    }
    return `${proto}://${host}`;
  }

  // ── Notas ─────────────────────────────────────────────────────────────────
  @Get('contacts/:contactId/notes')
  async listNotes(
    @Req() req: RequestWithTenantUser,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ) {
    const db = this.db(req);
    await this.crm.assertAccess(db, contactId, this.owner(req));
    return this.crm.listNotes(db, contactId);
  }

  @Post('contacts/:contactId/notes')
  @HttpCode(HttpStatus.CREATED)
  async addNote(
    @Req() req: RequestWithTenantUser,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @CurrentTenantUser() op: Operator,
    @Body() body: { body?: unknown },
  ) {
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (!text) throw new BadRequestException('La nota no puede estar vacía.');
    if (text.length > 4000) {
      throw new BadRequestException('La nota es demasiado larga (máx 4000).');
    }
    const db = this.db(req);
    await this.crm.assertAccess(db, contactId, this.owner(req));
    return this.crm.addNote(db, contactId, op.id, text);
  }

  // ── Tags ────────────────────────────────────────────────────────────────
  @Get('tags')
  async listTags(@Req() req: RequestWithTenantUser) {
    return this.crm.listTagCatalog(this.db(req));
  }

  /**
   * El catálogo con **cuántos contactos usa cada etiqueta**, para la pantalla
   * de Configuración.
   *
   * Va aparte de `GET tags` y no lo reemplaza: ese lo usa el selector de la
   * ficha, donde el conteo no sirve para nada y sería un `count` por etiqueta
   * en cada apertura de contacto.
   */
  @Get('tags/catalogo')
  async listTagsConUso(@Req() req: RequestWithTenantUser) {
    return this.crm.listTagCatalogConUso(this.db(req));
  }

  /**
   * Renombrar o recolorear una etiqueta.
   *
   * ⚠️ **Pide `tenant.settings.edit`, no basta con tener acceso al CRM.** El
   * catálogo es de TODO el tenant: una etiqueta que renombra un socio
   * independiente se le renombra también al staff central y a los demás. El
   * comentario de las plantillas ya anticipaba que la gestión fina tenía que
   * ser admin-only; acá es donde se cumple.
   */
  @Patch('tags/:tagId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('tenant.settings.edit')
  async editTag(
    @Req() req: RequestWithTenantUser,
    @Param('tagId', ParseUUIDPipe) tagId: string,
    @Body() body: { label?: unknown; color?: unknown },
  ) {
    const cambios: { label?: string; color?: string | null } = {};
    if (typeof body?.label === 'string') {
      const label = body.label.trim();
      if (!label) throw new BadRequestException('El tag necesita un nombre.');
      if (label.length > 40) {
        throw new BadRequestException('El nombre del tag es muy largo (máx 40).');
      }
      cambios.label = label;
    }
    if (typeof body?.color === 'string' || body?.color === null) {
      cambios.color = body.color || null;
    }
    if (Object.keys(cambios).length === 0) {
      throw new BadRequestException('No hay nada que cambiar.');
    }
    return this.crm.editarTag(this.db(req), tagId, cambios);
  }

  /**
   * Borrar una etiqueta del catálogo.
   *
   * ⚠️ **La saca de todos los contactos que la tenían** (`ON DELETE CASCADE`) y
   * no se puede deshacer. Mismo permiso que renombrar, y por el mismo motivo:
   * el catálogo es de todo el tenant.
   */
  @Delete('tags/:tagId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('tenant.settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTag(
    @Req() req: RequestWithTenantUser,
    @Param('tagId', ParseUUIDPipe) tagId: string,
  ) {
    await this.crm.borrarTag(this.db(req), tagId);
  }

  @Post('tags')
  @HttpCode(HttpStatus.CREATED)
  async createTag(
    @Req() req: RequestWithTenantUser,
    @Body() body: { label?: unknown; color?: unknown },
  ) {
    const label = typeof body?.label === 'string' ? body.label.trim() : '';
    if (!label) throw new BadRequestException('El tag necesita un nombre.');
    if (label.length > 40) {
      throw new BadRequestException('El nombre del tag es muy largo (máx 40).');
    }
    const color =
      typeof body?.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(body.color)
        ? body.color
        : null;
    return this.crm.createTag(this.db(req), label, color);
  }

  @Get('contacts/:contactId/tags')
  async listContactTags(
    @Req() req: RequestWithTenantUser,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ) {
    const db = this.db(req);
    await this.crm.assertAccess(db, contactId, this.owner(req));
    return this.crm.listContactTags(db, contactId);
  }

  @Post('contacts/:contactId/tags')
  @HttpCode(HttpStatus.CREATED)
  async assignTag(
    @Req() req: RequestWithTenantUser,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @CurrentTenantUser() op: Operator,
    @Body() body: { tagId?: unknown },
  ) {
    const tagId = typeof body?.tagId === 'string' ? body.tagId : '';
    if (!tagId) throw new BadRequestException('Falta el tag.');
    const db = this.db(req);
    await this.crm.assertAccess(db, contactId, this.owner(req));
    await this.crm.assignTag(db, contactId, tagId, op.id);
    return { ok: true };
  }

  @Delete('contacts/:contactId/tags/:tagId')
  async unassignTag(
    @Req() req: RequestWithTenantUser,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
  ) {
    const db = this.db(req);
    await this.crm.assertAccess(db, contactId, this.owner(req));
    await this.crm.unassignTag(db, contactId, tagId);
    return { ok: true };
  }

  // ── Plantillas (respuestas rápidas por tenant) ────────────────────────────
  // Tenant-wide (como el catálogo de tags): sin contactId, autorizadas por
  // TenantJwtGuard + CrmAccessGuard + @PanelOnly. La gestión fina (admin-only)
  // llegará con la config por tenant del panel (docs/22 §4.3).
  @Get('templates')
  async listTemplates(@Req() req: RequestWithTenantUser) {
    return this.crm.listTemplates(this.db(req));
  }

  @Post('templates')
  @HttpCode(HttpStatus.CREATED)
  async createTemplate(
    @Req() req: RequestWithTenantUser,
    @Body() body: { title?: unknown; body?: unknown; shortcut?: unknown },
  ) {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title) throw new BadRequestException('La plantilla necesita un título.');
    if (title.length > 120) {
      throw new BadRequestException('El título es muy largo (máx 120).');
    }
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (!text) throw new BadRequestException('La plantilla no puede estar vacía.');
    if (text.length > 4000) {
      throw new BadRequestException('La plantilla es demasiado larga (máx 4000).');
    }
    const shortcut =
      typeof body?.shortcut === 'string' && body.shortcut.trim()
        ? body.shortcut.trim().slice(0, 40)
        : null;
    return this.crm.createTemplate(this.db(req), title, text, shortcut);
  }

  /**
   * Editar una plantilla.
   *
   * Pide `tenant.settings.edit` por lo mismo que las etiquetas: el catálogo es
   * de **todo el tenant**, así que lo que edita uno lo ven todos.
   */
  @Patch('templates/:templateId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('tenant.settings.edit')
  async editTemplate(
    @Req() req: RequestWithTenantUser,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() body: { title?: unknown; body?: unknown; shortcut?: unknown },
  ) {
    const cambios: { title?: string; body?: string; shortcut?: string | null } = {};
    if (typeof body?.title === 'string') {
      const title = body.title.trim();
      if (!title) throw new BadRequestException('La plantilla necesita un título.');
      cambios.title = title;
    }
    if (typeof body?.body === 'string') {
      const texto = body.body.trim();
      if (!texto) throw new BadRequestException('La plantilla necesita un cuerpo.');
      cambios.body = texto;
    }
    if (typeof body?.shortcut === 'string' || body?.shortcut === null) {
      cambios.shortcut = body.shortcut?.trim() || null;
    }
    if (Object.keys(cambios).length === 0) {
      throw new BadRequestException('No hay nada que cambiar.');
    }
    return this.crm.editarTemplate(this.db(req), templateId, cambios);
  }

  /**
   * Borrar una plantilla.
   *
   * ⚠️ **Antes esto no pedía ningún permiso**: cualquier operador con acceso al
   * CRM podía borrar una plantilla que usaba todo el casino. Es el mismo hueco
   * que tenían las etiquetas, y se cierra igual — con `tenant.settings.edit`.
   */
  @Delete('templates/:templateId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('tenant.settings.edit')
  async deleteTemplate(
    @Req() req: RequestWithTenantUser,
    @Param('templateId', ParseUUIDPipe) templateId: string,
  ) {
    await this.crm.deleteTemplate(this.db(req), templateId);
    return { ok: true };
  }
}
