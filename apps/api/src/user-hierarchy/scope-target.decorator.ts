/**
 * `@ScopeTarget(field, location)` — declara qué campo del request leer
 * para obtener el `targetUserId` que el ScopeGuard va a validar.
 *
 * Uso:
 *   @ScopeTarget('targetUserId', 'body')
 *   @ScopeTarget('userId', 'param')
 *
 * Si no se declara, el ScopeGuard skipea (no chequea nada y deja pasar).
 * Esto permite proteger solo endpoints específicos sin afectar el resto.
 *
 * Por qué necesitamos esto: distintos endpoints tienen el target en
 * lugares distintos del request (body.targetUserId, param.id,
 * query.userId, etc.). El guard genérico necesita saber dónde leer.
 */

import { SetMetadata } from '@nestjs/common';

export type ScopeTargetLocation = 'body' | 'param' | 'query';

export interface ScopeTargetMeta {
  field: string;
  location: ScopeTargetLocation;
}

export const SCOPE_TARGET_KEY = 'scopeTarget';

export const ScopeTarget = (
  field: string,
  location: ScopeTargetLocation = 'body',
): MethodDecorator =>
  SetMetadata(SCOPE_TARGET_KEY, { field, location } satisfies ScopeTargetMeta);
