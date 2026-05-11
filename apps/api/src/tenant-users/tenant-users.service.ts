/**
 * TenantUsersService — queries sobre la tabla `users` de un tenant.
 *
 * A diferencia de PlatformUsersService (que usa CONTROL_DB inyectado),
 * este service recibe el cliente Drizzle del tenant en cada llamada.
 * El cliente viene del TenantContext (resuelto por TenantResolverMiddleware).
 *
 * Esto permite que el mismo service sirva a cualquier tenant.
 */

import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users, type User } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

@Injectable()
export class TenantUsersService {
  async findById(db: TenantDb, id: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return (rows[0] as User | undefined) ?? null;
  }

  async findByUsername(db: TenantDb, username: string): Promise<User | null> {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return (rows[0] as User | undefined) ?? null;
  }

  async findByEmail(db: TenantDb, email: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return (rows[0] as User | undefined) ?? null;
  }

  async markLoggedIn(db: TenantDb, id: string): Promise<void> {
    await db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id));
  }
}
