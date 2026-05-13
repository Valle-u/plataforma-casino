/**
 * `@AllowWithoutTwoFa()` — bypass del `TwoFaPolicyGuard` para un endpoint.
 *
 * Marcar el handler (o todo el controller) con esto declara que el
 * endpoint es accesible aunque el user tenga rol operativo y todavía no
 * tenga 2FA configurado. Necesario para los endpoints que el user usa
 * justamente para configurar 2FA — sin este bypass el sistema sería
 * inarrancable (el admin no puede llegar a /2fa/init porque /2fa/init
 * mismo requeriría 2FA).
 *
 * Aplicar a:
 *   - GET /tenant/auth/me  (info básica, no muta nada)
 *   - POST /tenant/auth/2fa/init
 *   - POST /tenant/auth/2fa/confirm
 *   - POST /tenant/auth/logout
 *   - GET /tenant/auth/2fa/recovery-codes/count (lectura inocua)
 *
 * NO aplicar a endpoints que mutan estado del tenant (mint/burn/load/...).
 */

import { SetMetadata } from '@nestjs/common';

export const ALLOW_WITHOUT_TWO_FA_METADATA = 'allow-without-two-fa';

export const AllowWithoutTwoFa = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_WITHOUT_TWO_FA_METADATA, true);
