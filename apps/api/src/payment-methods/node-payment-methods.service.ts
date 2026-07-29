import { Injectable } from '@nestjs/common';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import type { PaymentMethod } from '@casino/db';
import { PaymentMethodsService } from './payment-methods.service';

export interface CreateNodePaymentMethodParams {
  code: string;
  name: string;
  type: 'bank_transfer' | 'crypto' | 'other';
  config?: Record<string, unknown>;
  chipsPerUnit?: number;
}

export interface UpdateNodePaymentMethodParams {
  name?: string;
  config?: Record<string, unknown>;
  chipsPerUnit?: number;
  isActive?: boolean;
}

@Injectable()
export class NodePaymentMethodsService {
  constructor(
    private readonly pm: PaymentMethodsService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  /**
   * Lista los métodos de pago de un nodo independiente.
   */
  async listByOwner(db: TenantDb, ownerId: string): Promise<PaymentMethod[]> {
    return this.pm.list(db, { activeOnly: false, ownerId });
  }

  /**
   * Crea un método de pago para un nodo independiente.
   */
  async create(
    db: TenantDb,
    ownerId: string,
    params: CreateNodePaymentMethodParams,
  ): Promise<PaymentMethod> {
    return this.pm.create(db, { ...params, ownerId });
  }

  /**
   * Actualiza un método de pago de un nodo, verificando ownership.
   */
  async update(
    db: TenantDb,
    id: string,
    ownerId: string,
    patch: UpdateNodePaymentMethodParams,
  ): Promise<PaymentMethod> {
    await this.pm.findByIdAndOwner(db, id, ownerId);
    return this.pm.update(db, id, patch);
  }

  /**
   * Archiva (soft-delete) un método de pago de un nodo, verificando ownership.
   */
  async archive(
    db: TenantDb,
    id: string,
    ownerId: string,
  ): Promise<PaymentMethod> {
    const method = await this.pm.findByIdAndOwner(db, id, ownerId);
    if (!method.isActive) return method;
    return this.pm.update(db, id, { isActive: false });
  }

  /**
   * Para un player, devuelve los métodos de pago de su padre independiente
   * más cercano. Si no tiene padre independiente, devuelve los métodos
   * del tenant (nivel plataforma).
   */
  async listForPlayer(
    db: TenantDb,
    playerId: string,
  ): Promise<PaymentMethod[]> {
    const parentId =
      await this.hierarchy.getNearestIndependentBranchAncestor(db, playerId);
    if (parentId) {
      return this.pm.list(db, { activeOnly: true, ownerId: parentId });
    }
    return this.pm.list(db, { activeOnly: true, ownerId: null });
  }

  /**
   * Para el node owner, devuelve sus métodos activos.
   */
  async listActiveByOwner(
    db: TenantDb,
    ownerId: string,
  ): Promise<PaymentMethod[]> {
    return this.pm.list(db, { activeOnly: true, ownerId });
  }
}
