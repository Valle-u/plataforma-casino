/**
 * AlertsModule — avisos operativos por Telegram.
 *
 * Global a propósito: los avisos salen de lugares muy distintos (el cron de
 * reconciliación, los callbacks de proveedores, el detector de jugadores que no
 * pueden jugar) y no tiene sentido reimportarlo en cada uno.
 *
 * Ver `AlertsService` para las reglas: nunca tira, no spamea, y sin token queda
 * apagado.
 */

import { Global, Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';

@Global()
@Module({
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
