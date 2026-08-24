/**
 * ChatGateway — gateway WebSocket (socket.io) del CRM/livechat.
 *
 * AUTH: el WS es cross-origin (front en Vercel, WS en la API), así que la cookie
 * no viaja. El cliente pide un token corto por HTTP (`POST /tenant/chat/ws-token`,
 * ver ChatController) y lo pasa en el handshake (`auth.token`). Acá lo verificamos
 * (firma + `purpose: 'chat-ws'`), resolvemos la DB del tenant y unimos el socket
 * a su room. Un handshake sin token válido se desconecta.
 *
 * Etapa 1: `message:send` del JUGADOR (persiste + rutea al operador directo). El
 * lado operador (responder, inbox, typing, visto) y el widget/inbox del front
 * son los sub-tramos siguientes. Ver docs/22-crm-livechat.md.
 *
 * Adapter: IoAdapter por defecto de Nest (attach al server HTTP, sin tocar
 * main.ts). Redis adapter (multi-instancia) = cuando corran >1 réplica. Todo
 * esto solo se instancia si CRM_ENABLED (ChatModule importado).
 */

import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { ChatService } from './chat.service';
import { CrmNetworkService } from './crm-network.service';

interface WsTokenPayload {
  sub: string;
  tenantId: string;
  username?: string;
  purpose?: string;
}

/** Lo que guardamos en `socket.data` tras un handshake válido. */
interface ChatSocketData {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  username?: string;
  db: TenantDb;
  /**
   * A qué `assignedOperatorId` puede acceder este operador (su bandeja):
   * su propio id (red independiente), el admin principal (staff central), o
   * `null` si NO tiene acceso al CRM (operador de la red dependiente / jugador
   * sin rol de staff). Se resuelve una vez en el handshake. Ver CrmNetworkService.
   */
  inboxOwnerId: string | null;
}

@WebSocketGateway({
  namespace: '/chat',
  // El token es la barrera de seguridad real (no la cookie), así que reflejamos
  // el origin. Se puede endurecer con una allowlist por env cuando haga falta.
  cors: { origin: true },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer() private readonly server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly chat: ChatService,
    private readonly net: CrmNetworkService,
  ) {}

  /**
   * Auth del handshake en un MIDDLEWARE de socket.io (corre y COMPLETA antes de
   * que el cliente reciba `connect`), así `socket.data` (incl. la DB del tenant)
   * ya está poblado cuando llega el primer mensaje. Si lo hiciéramos en
   * handleConnection —que es async y no se awaitea— habría una race: un cliente
   * que emita apenas conecta pegaría contra `data.db` sin setear y su mensaje se
   * descartaría en silencio. Un handshake inválido se rechaza acá (connect_error).
   */
  afterInit(server: Server): void {
    server.use((socket, next) => {
      void (async () => {
        try {
          const token = this.extractToken(socket);
          if (!token) throw new Error('sin token');
          const payload = await this.jwt.verifyAsync<WsTokenPayload>(token);
          if (
            payload.purpose !== 'chat-ws' ||
            !payload.tenantId ||
            !payload.sub
          ) {
            throw new Error('token invalido');
          }
          const resolved = await this.chat.resolveTenant(payload.tenantId);
          if (!resolved) throw new Error('tenant no resuelto');

          const data = socket.data as ChatSocketData;
          data.userId = payload.sub;
          data.tenantId = payload.tenantId;
          data.tenantSlug = resolved.slug;
          data.username = payload.username;
          data.db = resolved.db;
          // Bandeja a la que accede este operador (o null si no tiene acceso).
          // Se resuelve una vez acá para no re-clasificar en cada mensaje.
          data.inboxOwnerId = await this.net.resolveInboxOwner(
            resolved.db,
            payload.sub,
          );
          next();
        } catch (err) {
          this.logger.warn(`handshake rechazado: ${(err as Error).message}`);
          next(new Error('unauthorized'));
        }
      })();
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const data = client.data as ChatSocketData;
    // El middleware ya validó y pobló socket.data; acá solo unimos la room.
    if (!data?.userId || !data?.db) {
      client.disconnect(true);
      return;
    }
    await client.join(this.opRoom(data.tenantId, data.userId));
    // Staff central (admin + empleados): además de su propia room, se unen a la
    // room de la BANDEJA CENTRAL (la del admin principal) para recibir en vivo
    // los chats de la red dependiente, que se rutean ahí.
    if (data.inboxOwnerId && data.inboxOwnerId !== data.userId) {
      await client.join(this.opRoom(data.tenantId, data.inboxOwnerId));
    }
    this.logger.log(`connect user=${data.userId} tenant=${data.tenantId}`);
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as ChatSocketData;
    if (data?.userId) this.logger.log(`disconnect user=${data.userId}`);
  }

  /**
   * El JUGADOR manda un mensaje. Resuelve/crea su conversación, persiste el
   * mensaje inbound, y lo emite a la room de su operador directo + a la room de
   * la conversación. Devuelve el mensaje como ack.
   */
  @SubscribeMessage('message:send')
  async handleMessageSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { body?: unknown; attachments?: unknown },
  ): Promise<{ ok: boolean; message?: unknown; error?: string }> {
    const data = client.data as ChatSocketData;
    if (!data?.db) return { ok: false, error: 'no autorizado' };
    const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
    const attachments = this.chat.sanitizeAttachments(
      payload?.attachments,
      data.tenantSlug,
    );
    if (!body && attachments.length === 0) {
      return { ok: false, error: 'mensaje vacío' };
    }
    try {
      // Ruteo: red independiente → operador directo; red dependiente → bandeja
      // central (admin principal). Ver CrmNetworkService.
      const operatorId = await this.net.resolveAssignedOperator(
        data.db,
        data.userId,
      );
      const channelId = await this.chat.getOrCreateWebChannel(data.db);
      const contactId = await this.chat.getOrCreateContactForUser(
        data.db,
        data.userId,
      );
      const conv = await this.chat.getOrCreateOpenConversation(data.db, {
        contactId,
        channelId,
        operatorId,
      });
      const message = await this.chat.postMessage(data.db, {
        conversationId: conv.id,
        direction: 'inbound',
        senderUserId: data.userId,
        body,
        attachments,
      });

      // El jugador se une a la room de la conversación (recibe respuestas).
      await client.join(this.convRoom(data.tenantId, conv.id));
      // Emitir al operador directo (su bandeja) + a la conversación.
      const evt = { conversationId: conv.id, message };
      if (operatorId) {
        this.server
          .to(this.opRoom(data.tenantId, operatorId))
          .emit('message:new', evt);
      }
      this.server
        .to(this.convRoom(data.tenantId, conv.id))
        .emit('message:new', evt);

      return { ok: true, message };
    } catch (err) {
      this.logger.error(`message:send falló: ${(err as Error).message}`);
      return { ok: false, error: 'no se pudo enviar' };
    }
  }

  /**
   * El JUGADOR abre el widget: carga su conversación abierta (si ya escribió
   * alguna vez) + historial, se une a la room (para recibir en vivo tras un
   * reload) y marca sus no-leídos en 0. FIND-ONLY: si nunca escribió, devuelve
   * conversación vacía sin crear nada (solo `message:send` crea).
   */
  @SubscribeMessage('conversation:me')
  async handlePlayerConversation(
    @ConnectedSocket() client: Socket,
  ): Promise<{
    ok: boolean;
    conversation?: unknown;
    messages?: unknown;
    error?: string;
  }> {
    const data = client.data as ChatSocketData;
    if (!data?.db) return { ok: false, error: 'no autorizado' };
    const conv = await this.chat.findOpenConversationForUser(
      data.db,
      data.userId,
    );
    if (!conv) return { ok: true, conversation: null, messages: [] };
    await client.join(this.convRoom(data.tenantId, conv.id));
    await this.chat.markReadForContact(data.db, conv.id);
    const messages = (await this.chat.listMessages(data.db, conv.id)).reverse();
    return { ok: true, conversation: conv, messages };
  }

  /**
   * El OPERADOR pide su bandeja: conversaciones asignadas a él, no resueltas.
   * (El ruteo ya garantiza que solo ve las suyas — ver ChatService.)
   */
  @SubscribeMessage('conversation:list')
  async handleConversationList(
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: boolean; conversations?: unknown; error?: string }> {
    const data = client.data as ChatSocketData;
    // Sin bandeja (operador de la red dependiente / no-staff) → sin acceso.
    if (!data?.db || !data.inboxOwnerId) {
      return { ok: false, error: 'no autorizado' };
    }
    const conversations = await this.chat.listOperatorInbox(
      data.db,
      data.inboxOwnerId,
    );
    return { ok: true, conversations };
  }

  /**
   * El OPERADOR abre una conversación suya: se une a la room (para recibir en
   * vivo), marca sus no-leídos en 0, avisa que leyó y devuelve el historial
   * (cronológico). Rechaza si la conversación no está asignada a él.
   */
  @SubscribeMessage('conversation:open')
  async handleConversationOpen(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId?: unknown },
  ): Promise<{
    ok: boolean;
    conversation?: unknown;
    messages?: unknown;
    error?: string;
  }> {
    const data = client.data as ChatSocketData;
    const conversationId =
      typeof payload?.conversationId === 'string' ? payload.conversationId : '';
    if (!data?.db || !conversationId) {
      return { ok: false, error: 'falta conversación' };
    }
    if (!data.inboxOwnerId) return { ok: false, error: 'no autorizado' };
    const conv = await this.chat.getConversationForOperator(
      data.db,
      conversationId,
      data.inboxOwnerId,
    );
    if (!conv) return { ok: false, error: 'no autorizado' };

    await client.join(this.convRoom(data.tenantId, conv.id));
    await this.chat.markReadForOperator(data.db, conv.id);
    const messages = (await this.chat.listMessages(data.db, conv.id)).reverse();
    // Recibo de lectura del operador (otras pestañas suyas + el jugador).
    this.server
      .to(this.convRoom(data.tenantId, conv.id))
      .emit('conversation:read', { conversationId: conv.id, by: 'operator' });
    return { ok: true, conversation: conv, messages };
  }

  /**
   * El OPERADOR responde. Valida que la conversación sea suya, persiste el
   * mensaje outbound y lo emite a la conversación (el jugador lo recibe) + a su
   * propia room (sincroniza su bandeja/otras pestañas).
   */
  @SubscribeMessage('message:reply')
  async handleMessageReply(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: { conversationId?: unknown; body?: unknown; attachments?: unknown },
  ): Promise<{ ok: boolean; message?: unknown; error?: string }> {
    const data = client.data as ChatSocketData;
    if (!data?.db) return { ok: false, error: 'no autorizado' };
    const conversationId =
      typeof payload?.conversationId === 'string' ? payload.conversationId : '';
    const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
    const attachments = this.chat.sanitizeAttachments(
      payload?.attachments,
      data.tenantSlug,
    );
    if (!conversationId || (!body && attachments.length === 0)) {
      return { ok: false, error: 'mensaje vacío' };
    }
    if (!data.inboxOwnerId) return { ok: false, error: 'no autorizado' };
    const conv = await this.chat.getConversationForOperator(
      data.db,
      conversationId,
      data.inboxOwnerId,
    );
    if (!conv) return { ok: false, error: 'no autorizado' };
    try {
      const message = await this.chat.postMessage(data.db, {
        conversationId: conv.id,
        direction: 'outbound',
        // Quién respondió es el operador real (empleado/admin), aunque la
        // conversación pertenezca a la bandeja central.
        senderUserId: data.userId,
        body,
        attachments,
      });
      const evt = { conversationId: conv.id, message };
      this.server
        .to(this.convRoom(data.tenantId, conv.id))
        .emit('message:new', evt);
      // A la room de la bandeja (dueña): sincroniza al admin + empleados (o al
      // operador independiente y sus otras pestañas).
      this.server
        .to(this.opRoom(data.tenantId, data.inboxOwnerId))
        .emit('message:new', evt);
      return { ok: true, message };
    } catch (err) {
      this.logger.error(`message:reply falló: ${(err as Error).message}`);
      return { ok: false, error: 'no se pudo enviar' };
    }
  }

  /**
   * Indicador de "está escribiendo…" (efímero, no se persiste). Solo se propaga
   * dentro de una conversación en la que el socket YA está (se unió al abrirla o
   * al mandar), así que no hace falta re-validar autorización acá.
   */
  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId?: unknown; isTyping?: unknown },
  ): void {
    const data = client.data as ChatSocketData;
    const conversationId =
      typeof payload?.conversationId === 'string' ? payload.conversationId : '';
    if (!data?.tenantId || !conversationId) return;
    const room = this.convRoom(data.tenantId, conversationId);
    if (!client.rooms.has(room)) return; // solo si está en la conversación
    client.to(room).emit('typing', {
      conversationId,
      userId: data.userId,
      isTyping: payload?.isTyping === true,
    });
  }

  private extractToken(client: Socket): string | undefined {
    const auth = client.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token;
    const q = client.handshake.query?.token;
    return typeof q === 'string' ? q : undefined;
  }

  /** Room del operador: recibe sus conversaciones asignadas + no leídos. */
  private opRoom(tenantId: string, userId: string): string {
    return `t:${tenantId}:op:${userId}`;
  }

  /** Room de una conversación. */
  private convRoom(tenantId: string, conversationId: string): string {
    return `t:${tenantId}:conv:${conversationId}`;
  }
}
