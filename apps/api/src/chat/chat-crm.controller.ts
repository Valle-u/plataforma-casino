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
import { ChatCrmService } from './chat-crm.service';
import { ChatService } from './chat.service';
import { CrmAccessGuard, type RequestWithCrmInbox } from './crm-access.guard';

type Operator = { id: string; username: string };

@Controller('tenant/chat')
@UseGuards(TenantJwtGuard, CrmAccessGuard)
@PanelOnly()
export class ChatCrmController {
  constructor(
    private readonly crm: ChatCrmService,
    // El ciclo de vida de la conversación (estado, no leídos) vive en
    // ChatService, junto al resto del hilo; el CRM es la ficha del contacto.
    private readonly chat: ChatService,
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

  @Delete('templates/:templateId')
  async deleteTemplate(
    @Req() req: RequestWithTenantUser,
    @Param('templateId', ParseUUIDPipe) templateId: string,
  ) {
    await this.crm.deleteTemplate(this.db(req), templateId);
    return { ok: true };
  }
}
