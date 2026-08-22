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
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { ChatService } from './chat.service';

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
  username?: string;
  db: TenantDb;
}

@WebSocketGateway({
  namespace: '/chat',
  // El token es la barrera de seguridad real (no la cookie), así que reflejamos
  // el origin. Se puede endurecer con una allowlist por env cuando haga falta.
  cors: { origin: true },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer() private readonly server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly chat: ChatService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('sin token');
      const payload = await this.jwt.verifyAsync<WsTokenPayload>(token);
      if (payload.purpose !== 'chat-ws' || !payload.tenantId || !payload.sub) {
        throw new Error('token invalido');
      }
      const db = await this.chat.getTenantDb(payload.tenantId);
      if (!db) throw new Error('tenant no resuelto');

      const data = client.data as ChatSocketData;
      data.userId = payload.sub;
      data.tenantId = payload.tenantId;
      data.username = payload.username;
      data.db = db;
      await client.join(this.opRoom(payload.tenantId, payload.sub));
      this.logger.log(`connect user=${payload.sub} tenant=${payload.tenantId}`);
    } catch (err) {
      this.logger.warn(`handshake rechazado: ${(err as Error).message}`);
      client.disconnect(true);
    }
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
    @MessageBody() payload: { body?: unknown },
  ): Promise<{ ok: boolean; message?: unknown; error?: string }> {
    const data = client.data as ChatSocketData;
    const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
    if (!data?.db || !body) return { ok: false, error: 'mensaje vacío' };
    try {
      const operatorId = await this.chat.resolveDirectOperator(
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
