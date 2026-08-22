/**
 * ChatGateway — gateway WebSocket (socket.io) del CRM/livechat.
 *
 * AUTH: el WS es cross-origin (front en Vercel, WS en la API), así que la cookie
 * no viaja. El cliente pide un token corto por HTTP (`POST /tenant/chat/ws-token`,
 * ver ChatController) y lo pasa en el handshake (`auth.token`). Acá lo verificamos
 * (firma + `purpose: 'chat-ws'`) y unimos el socket a su room. Un handshake sin
 * token válido se desconecta.
 *
 * Etapa 0: solo conexión/auth/rooms + un `ping` de salud. Los handlers de
 * mensajes/conversaciones (persistir en crm_messages, ruteo al operador directo)
 * llegan en Etapa 1. Ver docs/22-crm-livechat.md.
 *
 * Adapter: usa el IoAdapter por defecto de Nest (attach al server HTTP, sin
 * puerto ni cambio de bootstrap). El Redis adapter (multi-instancia) se agrega
 * cuando corran >1 réplica (ver doc §3/roadmap). Todo esto solo se instancia si
 * el ChatModule está importado, o sea si CRM_ENABLED.
 */

import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';

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
}

@WebSocketGateway({
  namespace: '/chat',
  // El token es la barrera de seguridad real (no la cookie), así que reflejamos
  // el origin. Se puede endurecer con una allowlist por env cuando haga falta.
  cors: { origin: true },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('sin token');
      const payload = await this.jwt.verifyAsync<WsTokenPayload>(token);
      if (payload.purpose !== 'chat-ws' || !payload.tenantId || !payload.sub) {
        throw new Error('token invalido');
      }
      const data = client.data as ChatSocketData;
      data.userId = payload.sub;
      data.tenantId = payload.tenantId;
      data.username = payload.username;
      await client.join(this.opRoom(payload.tenantId, payload.sub));
      this.logger.log(
        `connect user=${payload.sub} tenant=${payload.tenantId}`,
      );
    } catch (err) {
      this.logger.warn(`handshake rechazado: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as ChatSocketData;
    if (data?.userId) this.logger.log(`disconnect user=${data.userId}`);
  }

  /** Ping de salud para probar el pipe (Etapa 0). */
  @SubscribeMessage('ping')
  handlePing(): { pong: true; at: number } {
    return { pong: true, at: Date.now() };
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
}
