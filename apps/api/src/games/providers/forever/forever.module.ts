/**
 * ForeverModule — módulo del 2º proveedor de juegos (Forever, seamless).
 *
 * F1: cliente Main API (firmado Ed25519) + sync de catálogo + backend admin.
 * El callback seamless (GetBalance/ChangeBalance) que mueve fichas es F2 y
 * todavía NO está acá.
 */

import { Module } from '@nestjs/common';
import { TenantSettingsModule } from '../../../tenant-settings/tenant-settings.module';
import { ForeverClient } from './forever-client';
import { ForeverSyncService } from './forever-sync.service';
import { ForeverProviderBackend } from './forever-provider-backend';

@Module({
  imports: [TenantSettingsModule],
  providers: [ForeverClient, ForeverSyncService, ForeverProviderBackend],
  exports: [ForeverClient, ForeverSyncService, ForeverProviderBackend],
})
export class ForeverModule {}
