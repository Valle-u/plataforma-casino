/**
 * TenantUsersService — queries sobre la tabla `users` de un tenant.
 *
 * A diferencia de PlatformUsersService (que usa CONTROL_DB inyectado),
 * este service recibe el cliente Drizzle del tenant en cada llamada.
 * El cliente viene del TenantContext (resuelto por TenantResolverMiddleware).
 *
 * Esto permite que el mismo service sirva a cualquier tenant.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import {
  hashPassword,
  roles,
  userPermissionOverrides,
  userRoles,
  users,
  type User,
} from '@casino/db';
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

export interface UpdateUserParams {
  status?: 'active' | 'suspended' | 'banned' | 'pending';
  displayName?: string;
  email?: string;
  phone?: string;
}

/**
 * F1.1a — Perms económicos de aprobación/mint/burn/inyección que un cajero
 * o distribuidor NO debe recibir cuando lo crea un socio dependiente (o un
 * subordinado suyo). Se aplican como overrides `revoke` sobre los perms base
 * que el rol de piso trae por default (via `role_permissions`) — así el
 * empleado queda restringido a operativa de bajo riesgo (ver estados, cargar
 * fichas contra su cupo, gestionar bonos si se le delega).
 *
 * Nota: `wallet.mint` no existe en el catálogo (el minteo es solo interno,
 * source de wallet_transactions). Se omite.
 *
 * Ver docs/03 §7 (jerarquía y overrides) y el diseño F1.1a.
 */
export const DEPENDENT_BRANCH_EMPLOYEE_DENY_PERMISSIONS = [
  // Deposits
  'deposits.approve',
  'deposits.approve_admin_network',
  'deposits.reject',
  'deposits.reject_admin_network',
  // Withdrawals
  'withdrawals.approve',
  'withdrawals.approve_admin_network',
  'withdrawals.reject',
  'withdrawals.reject_admin_network',
  'withdrawals.process',
  'withdrawals.process_admin_network',
  // Wallet — correcciones/mint/burn/inyección
  'wallet.correct',
  'wallet.correct_admin_network',
  'wallet.burn',
  'house.inject_capital',
] as const;

/**
 * Roles que se consideran "empleados de piso" para la política F1.1a.
 *
 * IMPORTANTE: incluimos `empleado` porque `canAssignRole('socio', 'empleado')`
 * es TRUE (empleado rank=4, socio rank=1). Sin `empleado` acá, un socio dep
 * podría crear un user con rol=empleado en lugar de cajero/distribuidor para
 * saltear la política (H1a-5 del adversarial review).
 */
export const DEPENDENT_BRANCH_RESTRICTED_ROLES = [
  'cajero',
  'distribuidor',
  'empleado',
] as const;

@Injectable()
export class TenantUsersService {
  async findById(db: TenantDb, id: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return (rows[0]) ?? null;
  }

  async findByUsername(db: TenantDb, username: string): Promise<User | null> {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return (rows[0]) ?? null;
  }

  async findByEmail(db: TenantDb, email: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return (rows[0]) ?? null;
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

  /**
   * Actualiza campos opcionales de un user. Idempotente.
   *
   * Validaciones:
   *   - El user debe existir (404 si no).
   *   - Si se cambia email, no debe estar en uso por OTRO user (409).
   *
   * No actualiza password (eso requiere endpoint específico con re-hash).
   * No actualiza username (es identificador, mejor crear user nuevo si hace falta).
   */
  async update(db: TenantDb, userId: string, params: UpdateUserParams): Promise<User> {
    const existing = await this.findById(db, userId);
    if (!existing) {
      throw new NotFoundException(`User ${userId} no existe.`);
    }

    // Email uniqueness: si se está cambiando, no debe estar en uso por otro user.
    if (params.email && params.email !== existing.email) {
      const conflict = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, params.email), ne(users.id, userId)))
        .limit(1);
      if (conflict.length > 0) {
        throw new ConflictException(`Email "${params.email}" ya en uso.`);
      }
    }

    // Construimos el patch con solo los campos que vinieron.
    const patch: Partial<{
      status: User['status'];
      displayName: string;
      email: string | null;
      phone: string | null;
      updatedAt: Date;
    }> = { updatedAt: new Date() };

    if (params.status !== undefined) patch.status = params.status;
    if (params.displayName !== undefined) patch.displayName = params.displayName;
    if (params.email !== undefined) patch.email = params.email;
    if (params.phone !== undefined) patch.phone = params.phone;

    // Si solo vino updatedAt, evitamos UPDATE redundante (idempotencia real).
    if (Object.keys(patch).length === 1) {
      return existing;
    }

    const updated = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, userId))
      .returning();

    const result = updated[0];
    if (!result) {
      throw new Error('Update user falló sin error explícito.');
    }
    return result;
  }

  /**
   * Sprint 51.4: resetea la password de un user. NO valida scope ni
   * permisos — eso lo hace el controller (PermissionsGuard + ScopeGuard
   * + opcional 2FA). Solo se ocupa de:
   *   - Validar que el target existe.
   *   - Validar largo mínimo (defensa en profundidad — el DTO también).
   *   - Hashear con Argon2id + UPDATE.
   *
   * NO invalida sesiones activas del target (sería sprint aparte: bumping
   * the JWT issued-at threshold por user).
   */
  async resetPassword(
    db: TenantDb,
    targetUserId: string,
    newPassword: string,
  ): Promise<User> {
    const existing = await this.findById(db, targetUserId);
    if (!existing) {
      throw new NotFoundException(`User ${targetUserId} no existe.`);
    }
    if (newPassword.length < 8) {
      throw new BadRequestException(
        'La nueva password debe tener al menos 8 caracteres.',
      );
    }
    const passwordHash = await hashPassword(newPassword);
    const updated = await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, targetUserId))
      .returning();
    const result = updated[0];
    if (!result) {
      throw new Error('Reset password falló sin error explícito.');
    }
    return result;
  }

  /**
   * Asigna un rol a un user. Idempotente — si ya tenía el rol, no falla.
   * 404 si el user o el rol no existen.
   */
  async addRole(
    db: TenantDb,
    userId: string,
    roleCode: string,
    actorId: string,
  ): Promise<{ added: boolean }> {
    const user = await this.findById(db, userId);
    if (!user) throw new NotFoundException(`User ${userId} no existe.`);

    const roleRows = await db.select().from(roles).where(eq(roles.code, roleCode)).limit(1);
    const role = roleRows[0];
    if (!role) throw new BadRequestException(`Rol "${roleCode}" no existe.`);

    const result = await db
      .insert(userRoles)
      .values({ userId: user.id, roleId: role.id, grantedBy: actorId })
      .onConflictDoNothing()
      .returning();

    return { added: result.length > 0 };
  }

  /**
   * Quita un rol del user. Idempotente — si no lo tenía, devuelve removed=false.
   * 404 si el user no existe. Si el rol no existe, removed=false (no FK error).
   */
  async removeRole(
    db: TenantDb,
    userId: string,
    roleCode: string,
  ): Promise<{ removed: boolean }> {
    const user = await this.findById(db, userId);
    if (!user) throw new NotFoundException(`User ${userId} no existe.`);

    const roleRows = await db.select().from(roles).where(eq(roles.code, roleCode)).limit(1);
    const role = roleRows[0];
    if (!role) {
      // Si el rol no existe, claramente el user no lo tiene asignado.
      return { removed: false };
    }

    const result = await db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, user.id), eq(userRoles.roleId, role.id)))
      .returning();

    return { removed: result.length > 0 };
  }

  /**
   * F1.1a — Inserta overrides `revoke` sobre el nuevo user para bloquear los
   * perms económicos peligrosos que el rol base (`cajero`/`distribuidor`)
   * trae por default. Se usa cuando el creador es un actor "dependiente"
   * (no admin, no socio indep, no dentro de sub-red indep).
   *
   * Idempotente vía ON CONFLICT DO UPDATE — si el user ya tenía un override
   * `grant` para alguno de estos codes (caso raro, no debería pasar en
   * create), lo pisa con `revoke`.
   *
   * `grantedBy` = actorUserId (queda registrado quién creó al empleado y
   * disparó la política). `reason` explícito para el audit trail.
   */
  async applyDependentBranchEmployeeRestrictions(
    db: TenantDb,
    params: { targetUserId: string; actorUserId: string },
  ): Promise<{ deniedCodes: string[] }> {
    const codes = [...DEPENDENT_BRANCH_EMPLOYEE_DENY_PERMISSIONS];
    const values = codes.map((code) => ({
      userId: params.targetUserId,
      permissionCode: code,
      effect: 'revoke' as const,
      grantedBy: params.actorUserId,
      grantedByChain: [params.actorUserId],
      reason:
        'F1.1a: perm económico bloqueado por default (empleado creado por rama dependiente).',
    }));
    await db
      .insert(userPermissionOverrides)
      .values(values)
      .onConflictDoUpdate({
        target: [
          userPermissionOverrides.userId,
          userPermissionOverrides.permissionCode,
        ],
        set: {
          effect: 'revoke',
          grantedBy: params.actorUserId,
          grantedByChain: [params.actorUserId],
          reason:
            'F1.1a: perm económico bloqueado por default (empleado creado por rama dependiente).',
          grantedAt: new Date(),
        },
      });
    return { deniedCodes: codes };
  }

  /**
   * Devuelve los roles asignados al user (info completa, no solo IDs).
   */
  async getRoles(
    db: TenantDb,
    userId: string,
  ): Promise<Array<{ code: string; name: string; isSystem: boolean }>> {
    const rows = await db
      .select({
        code: roles.code,
        name: roles.name,
        isSystem: roles.isSystem,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));

    return rows;
  }
}
