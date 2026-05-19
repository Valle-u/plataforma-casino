/**
 * `@PanelOnly()` — marca un endpoint como exclusivo de usuarios con
 * panel access (cualquier rol distinto de `usuario_final`).
 *
 * Sprint 43 (security hardening). Sirve como defense-in-depth respecto
 * al check del endpoint `/tenant/auth/login`:
 *   - El login con audience='panel' ya rechaza emitir tokens a players.
 *   - Pero un player podría tener un JWT viejo emitido antes del fix,
 *     o el frontend admin podría tener un bug que llame con audience
 *     wrong, o un atacante podría forzar audience='player' al loguear
 *     y después usar el token contra endpoints admin.
 *   - El `PanelAccessGuard` re-valida en cada request, garantizando
 *     que ningún player pueda pegar a un endpoint admin sin importar
 *     cómo obtuvo el token.
 *
 * Uso:
 *   ```ts
 *   @Controller('tenant/users')
 *   @UseGuards(TenantJwtGuard, PanelAccessGuard)
 *   @PanelOnly()
 *   export class TenantUsersController { ... }
 *   ```
 *
 * O por endpoint individual cuando un controller tiene mixed:
 *   ```ts
 *   @Get('me')                       // OK para players
 *   getMyData() { ... }
 *
 *   @Get('all')
 *   @PanelOnly()                     // solo admins/cajeros/etc.
 *   listAll() { ... }
 *   ```
 *
 * El guard `PanelAccessGuard` busca esta metadata. Sin la decoración,
 * el guard NO bloquea (default open) — el opt-in es explícito para
 * que sea visible cuando el endpoint cambia de regla.
 */

import { SetMetadata } from '@nestjs/common';

export const PANEL_ONLY_METADATA = 'panel-only';

export const PanelOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PANEL_ONLY_METADATA, true);
