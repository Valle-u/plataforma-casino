/**
 * GregmornModule — módulo del 3er proveedor de juegos (Gregmorn Hub, seamless).
 *
 * Convive con Palace y Forever, no reemplaza a ninguno. Ver docs/gregmorn/*.
 *
 * Estado (docs/gregmorn/99-integration-plan.md):
 *   - Fase 1 · settings ......... ✅ claves `game_provider.gregmorn.*` en el registry.
 *   - Fase 2 · cliente y firma .. ✅ `GregmornClient` + `gregmorn-signer` (con tests).
 *   - Fase 3 · catálogo ......... ✅ `GregmornSyncService`.
 *   - Fase 4 · launch ........... ⬜ `GregmornGameProvider` (IGameProvider).
 *   - Fase 5 · callbacks ........ ⬜ controller + service seamless.
 *   - Fase 6 · panel ............ ⬜ `GregmornProviderBackend` (IProviderBackend).
 *
 * El alta en `GameProviderRegistry` / `ProviderBackendRegistry` se hace recién
 * con las fases 4 y 6: registrar el backend crea la fila en `game_providers`
 * (`GameProvidersService.ensureRow`) y con eso el proveedor aparece en el panel
 * con botones de sync/test que todavía no existen.
 */

import { Module } from '@nestjs/common';
import { TenantSettingsModule } from '../../../tenant-settings/tenant-settings.module';
import { GregmornClient } from './gregmorn-client';
import { GregmornSyncService } from './gregmorn-sync.service';

@Module({
  imports: [TenantSettingsModule],
  providers: [GregmornClient, GregmornSyncService],
  exports: [GregmornClient, GregmornSyncService],
})
export class GregmornModule {}
