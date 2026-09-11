/**
 * WheelEligibilityService — quién puede girar la ruleta diaria.
 *
 * Hasta el 2026-09-10 el endpoint de giro pedía **sólo sesión**: cualquiera con
 * un JWT del tenant giraba y cobraba fichas de la Casa, todos los días. Eso
 * incluía cajeros, socios, distribuidores, empleados y al propio admin. Para
 * premios `kind=bonus` lo frenaba de rebote `UserBonusesService`
 * (`BONUS_TARGET_NOT_PLAYER`, LEY **R8**), pero para premios `kind=chips` **no
 * lo frenaba nada**.
 *
 * Las reglas están en `docs/27-ruleta-diaria.md` §3. Se concentran acá, en un
 * solo lugar, porque las usan dos caminos distintos y **tienen que dar la misma
 * respuesta**:
 *
 *   - el listado de promos del jugador — para que no la vea, y
 *   - el giro — para que no pueda girar aunque arme el pedido a mano.
 *
 * Lo primero es una puerta; lo segundo es la cerradura. Si sólo se hiciera lo
 * primero, un `curl` alcanzaría. **P1**: permiso *y* scope, siempre.
 */

import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { roles, userRoles, users } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { ResponsibleGamingService } from '../responsible-gaming/responsible-gaming.service';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import {
  WheelAccountNotActiveError,
  WheelActorNotPlayerError,
  WheelIndependentNetworkError,
  WheelSelfExcludedError,
} from './promotions.errors';

@Injectable()
export class WheelEligibilityService {
  constructor(
    private readonly hierarchy: UserHierarchyService,
    private readonly responsibleGaming: ResponsibleGamingService,
  ) {}

  /**
   * Tira si `userId` no puede girar. El orden de los chequeos es deliberado:
   * primero el que descarta más gente con una sola consulta (rol + estado),
   * después el que camina la jerarquía, y último el de juego responsable.
   */
  async assertCanSpin(db: TenantDb, userId: string): Promise<void> {
    // 1. Rol y estado de la cuenta, en una sola consulta: las dos salen de
    //    `users` + `user_roles` y no tiene sentido pegarle dos veces.
    const rows = await db
      .select({ status: users.status, role: roles.code })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(users.id, userId));

    if (rows.length === 0) throw new WheelActorNotPlayerError(userId);

    // Un usuario puede tener varios roles (LEYES R7: un socio que además
    // juega). Alcanza con que NO tenga `usuario_final` para quedar afuera.
    const esJugador = rows.some((r) => r.role === 'usuario_final');
    if (!esJugador) throw new WheelActorNotPlayerError(userId);

    const status = rows[0]!.status;
    if (status !== 'active') throw new WheelAccountNotActiveError(userId, status);

    // 2. LEY E8 — aislamiento económico de la red independiente.
    //    Los premios los paga la Casa. Dárselos a un jugador de una sub-red
    //    independiente es que un actor externo fondee esa red, que es
    //    exactamente lo que E8 prohíbe.
    //
    //    Se usa `getNearestIndependentBranchAncestor` y no la variante
    //    self-inclusive: ésta resuelve **qué casa banca el juego** de este
    //    jugador, que es justo la pregunta que hace E8 (quién fondea). La otra
    //    está pensada para scope de bonos y se incluye a sí misma, que acá no
    //    corresponde — un jugador nunca es su propia sucursal.
    const bancaIndependiente =
      await this.hierarchy.getNearestIndependentBranchAncestor(db, userId);
    if (bancaIndependiente) {
      throw new WheelIndependentNetworkError(userId, bancaIndependiente);
    }

    // 3. Juego responsable. La ruleta es un estímulo diario para volver a
    //    jugar: es lo primero que no puede recibir alguien que pidió
    //    autoexcluirse.
    const exclusion = await this.responsibleGaming.getActiveExclusion(db, userId);
    if (exclusion) throw new WheelSelfExcludedError(userId);
  }

  /**
   * La misma pregunta sin excepciones, para filtrar el listado.
   *
   * Deliberadamente implementada **sobre `assertCanSpin`** y no en paralelo: si
   * fueran dos consultas distintas podrían divergir, y la forma en que eso se
   * rompe es la peor de todas — la ruleta aparece en pantalla y al girar da
   * 403, o peor, no aparece y sí se puede girar por API.
   */
  async canSpin(db: TenantDb, userId: string): Promise<boolean> {
    try {
      await this.assertCanSpin(db, userId);
      return true;
    } catch {
      return false;
    }
  }
}
