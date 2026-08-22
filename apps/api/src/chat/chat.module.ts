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
import { UserHierarchyModule } from '../user-hierarchy/user-hierarchy.module';
import { ChatController } from './chat.controller';
import { ChatCrmController } from './chat-crm.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatCrmService } from './chat-crm.service';

@Module({
  imports: [UserHierarchyModule],
  controllers: [ChatController, ChatCrmController],
  providers: [ChatGateway, ChatService, ChatCrmService],
})
export class ChatModule {}
