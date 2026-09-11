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
import { TenantUsersModule } from '../tenant-users/tenant-users.module';
import { ChatController } from './chat.controller';
import { ChatCrmController } from './chat-crm.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatCrmService } from './chat-crm.service';
import { CrmNetworkService } from './crm-network.service';
import { CrmMetricasService } from './crm-metricas.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CierreDeRedService } from './cierre-de-red.service';
import { TelegramApiService } from './telegram/telegram-api.service';
import { TelegramChannelsService } from './telegram/telegram-channels.service';
import { TelegramDescargaService } from './telegram/telegram-descarga.service';
import { TelegramInboundService } from './telegram/telegram-inbound.service';
import { TelegramOutboundService } from './telegram/telegram-outbound.service';
import { TelegramWebhookController } from './telegram/telegram-webhook.controller';
import { WhatsappWebhookController } from './whatsapp/whatsapp-webhook.controller';
import { WhatsappInboundService } from './whatsapp/whatsapp-inbound.service';
import { RetencionDeAdjuntosService } from './retencion-de-adjuntos.service';
import { RetencionDeAdjuntosCron } from './retencion-de-adjuntos.cron';
import { CrmAccessGuard } from './crm-access.guard';

@Module({
  imports: [UserHierarchyModule, TenantUsersModule],
  controllers: [
    ChatController,
    ChatCrmController,
    TelegramWebhookController,
    WhatsappWebhookController,
  ],
  providers: [
    ChatGateway,
    ChatService,
    ChatCrmService,
    CrmNetworkService,
    CrmMetricasService,
    CrmTimelineService,
    CierreDeRedService,
    CrmAccessGuard,
    TelegramApiService,
    TelegramChannelsService,
    TelegramInboundService,
    TelegramOutboundService,
    TelegramDescargaService,
    WhatsappInboundService,
    // El cron va apagado salvo `CHAT_RETENCION_ENABLED=1`. El servicio se
    // provee igual: se puede invocar a mano o desde un test sin prender nada.
    RetencionDeAdjuntosService,
    RetencionDeAdjuntosCron,
  ],
})
export class ChatModule {}
