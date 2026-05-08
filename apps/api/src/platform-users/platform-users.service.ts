/**
 * PlatformUsersService — queries sobre la tabla `platform_users` (DB de control).
 *
 * Acá viven los super-admins de la plataforma (los dueños del producto).
 * Los usuarios "operativos" (admins de tenant, socios, cajeros, etc.) viven
 * en las DBs de tenant individuales y se manejan en otro service.
 */

import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { CONTROL_DB } from '../database/database.module';
import type { ControlDb, PlatformUser } from '@casino/db';
import { platformUsers } from '@casino/db';

@Injectable()
export class PlatformUsersService {
  constructor(@Inject(CONTROL_DB) private readonly db: ControlDb) {}

  async findById(id: string): Promise<PlatformUser | null> {
    const rows = await this.db
      .select()
      .from(platformUsers)
      .where(eq(platformUsers.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<PlatformUser | null> {
    const rows = await this.db
      .select()
      .from(platformUsers)
      .where(eq(platformUsers.email, email))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Marca timestamp de último login. Útil para alertas de seguridad y auditoría.
   */
  async markLoggedIn(id: string): Promise<void> {
    await this.db
      .update(platformUsers)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(platformUsers.id, id));
  }
}
