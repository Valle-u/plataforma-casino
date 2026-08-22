/**
 * ChatModule — CRM/livechat propio (Etapa 0+). Ver docs/22-crm-livechat.md.
 *
 * Se importa CONDICIONALMENTE en app.module.ts (solo si CRM_ENABLED): con el
 * flag off, este módulo ni se carga → cero efecto en prod (aislamiento §10).
 *
 * No necesita imports propios: `JwtService` (para el token de WS) y
 * `TenantJwtGuard` vienen del `TenantAuthModule`, que es @Global().
 */

import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';

@Module({
  controllers: [ChatController],
  providers: [ChatGateway],
})
export class ChatModule {}
