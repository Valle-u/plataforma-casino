/**
 * TenantUsersService — queries sobre la tabla `users` de un tenant.
 *
 * A diferencia de PlatformUsersService (que usa CONTROL_DB inyectado),
 * este service recibe el cliente Drizzle del tenant en cada llamada.
 * El cliente viene del TenantContext (resuelto por TenantResolverMiddleware).
 *
 * Esto permite que el mismo service sirva a cualquier tenant.
 */

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { hashPassword, roles, userRoles, users, type User } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

export interface CreateUserParams {
  username: string;
  password: string;
  displayName: string;
  email?: string;
  phone?: string;
  roleCode: string;
  createdBy: string;
}

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

  /**
   * Crea un user nuevo + asigna un rol.
   *
   * Validaciones:
   *   - roleCode existe.
   *   - username no en uso.
   *   - email no en uso (si se provee).
   *
   * Hashea password con Argon2id antes de insertar.
   */
  async create(db: TenantDb, params: CreateUserParams): Promise<User> {
    // 1. Validar rol existe.
    const roleRows = await db
      .select()
      .from(roles)
      .where(eq(roles.code, params.roleCode))
      .limit(1);
    const role = roleRows[0];
    if (!role) {
      throw new BadRequestException(`Rol "${params.roleCode}" no existe.`);
    }

    // 2. Uniqueness checks (los unique constraints también lo enforce, pero
    //    queremos 409 amigables en lugar de 500).
    const existingByUsername = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, params.username))
      .limit(1);
    if (existingByUsername.length > 0) {
      throw new ConflictException(`Username "${params.username}" ya en uso.`);
    }
    if (params.email) {
      const existingByEmail = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, params.email))
        .limit(1);
      if (existingByEmail.length > 0) {
        throw new ConflictException(`Email "${params.email}" ya en uso.`);
      }
    }

    // 3. Hash + insert user.
    const passwordHash = await hashPassword(params.password);
    const insertedUser = await db
      .insert(users)
      .values({
        username: params.username,
        email: params.email ?? null,
        phone: params.phone ?? null,
        passwordHash,
        displayName: params.displayName,
        status: 'active',
      })
      .returning();
    const user = insertedUser[0];
    if (!user) {
      throw new Error('Insert user falló sin error explícito.');
    }

    // 4. Asignar rol.
    await db.insert(userRoles).values({
      userId: user.id,
      roleId: role.id,
      grantedBy: params.createdBy,
    });

    return user;
  }
}
