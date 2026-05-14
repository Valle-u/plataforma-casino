/**
 * TenantSettingsModule — key-value config bag por tenant.
 *
 * @Global porque cualquier módulo (fraud, bonuses, wallets, etc.)
 * puede querer leer settings sin re-importar este módulo.
 */

import { Global, Module } from '@nestjs/common';
import { TenantSettingsHistoryRetentionCron } from './tenant-settings-history-retention.cron';
import { TenantSettingsController } from './tenant-settings.controller';
import { TenantSettingsService } from './tenant-settings.service';

@Global()
@Module({
  controllers: [TenantSettingsController],
  providers: [TenantSettingsService, TenantSettingsHistoryRetentionCron],
  exports: [TenantSettingsService, TenantSettingsHistoryRetentionCron],
})
export class TenantSettingsModule {}
