/**
 * GregmornModule — módulo del 3er proveedor de juegos (Gregmorn Hub, seamless).
 *
 * Convive con Palace y Forever, no reemplaza a ninguno. Ver docs/gregmorn/*.
 *
 * Estado (docs/gregmorn/99-integration-plan.md):
 *   - Fase 1 · settings ......... ✅ claves `game_provider.gregmorn.*` en el registry.
 *   - Fase 2 · cliente y firma .. ✅ `GregmornClient` + `gregmorn-signer` (con tests).
 *   - Fase 3 · catálogo ......... ✅ `GregmornSyncService`.
 *   - Fase 4 · launch ........... ✅ `GregmornGameProvider`, ya en `GameProviderRegistry`.
 *   - Fase 5 · callbacks ........ ✅ controller + service seamless (mueve plata).
 *   - Fase 6 · panel ............ ⬜ `GregmornProviderBackend` (IProviderBackend).
 *
 * Falta el alta en `ProviderBackendRegistry` (Fase 6): registrar el backend crea
 * la fila en `game_providers` (`GameProvidersService.ensureRow`) y con eso el
 * proveedor aparece en el panel con botones de sync/test que todavía no existen.
 */

import { Module } from '@nestjs/common';
import { WalletModule } from '../../../wallet/wallet.module';
import { TenantResolverModule } from '../../../tenant-resolver/tenant-resolver.module';
import { TenantSettingsModule } from '../../../tenant-settings/tenant-settings.module';
import { GameProviderLogsModule } from '../../game-provider-logs.module';
import { GregmornClient } from './gregmorn-client';
import { GregmornSyncService } from './gregmorn-sync.service';
import { GregmornGameProvider } from './gregmorn-game-provider';
import { GregmornCallbackService } from './gregmorn-callback.service';
import { GregmornCallbackController } from './gregmorn-callback.controller';

@Module({
  imports: [
    WalletModule,
    TenantResolverModule,
    TenantSettingsModule,
    GameProviderLogsModule,
  ],
  controllers: [GregmornCallbackController],
  providers: [
    GregmornClient,
    GregmornSyncService,
    GregmornGameProvider,
    GregmornCallbackService,
  ],
  exports: [GregmornClient, GregmornSyncService, GregmornGameProvider],
})
export class GregmornModule {}
