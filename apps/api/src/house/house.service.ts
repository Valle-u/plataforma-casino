/**
 * HouseService — resuelve la cuenta "Casa" / tesorería del tenant.
 *
 * Blindaje del núcleo económico, Parte B (ver docs/16-tesoreria.md). La Casa es
 * un usuario de SISTEMA (`is_system`, username `__casa__`) con su wallet: la
 * única fuente de fichas y la contraparte de todo (depósitos, juego, premios).
 *
 * B-build-1: solo resolución + estado (view). El aporte de capital, el routing
 * de depósitos/juego/premiaciones y el invariante de respaldo llegan en fases
 * siguientes (B-build-2..6).
 */

import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  HOUSE_USERNAME,
  users,
  wallets,
  type User,
  type Wallet,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

/** La Casa no está provisionada en este tenant (seed viejo / falta migrar). */
export class HouseNotProvisionedError extends Error {
  constructor() {
    super('La cuenta Casa / tesorería no está provisionada en este tenant.');
    this.name = 'HouseNotProvisionedError';
  }
}

export interface HouseState {
  userId: string;
  username: string;
  displayName: string;
  /** Fichas disponibles de la Casa. */
  balance: string;
  /** Fichas bloqueadas de la Casa (holds). */
  lockedBalance: string;
}

@Injectable()
export class HouseService {
  /** El usuario de la Casa. Null si el tenant no lo tiene provisionado. */
  async getHouseUser(db: TenantDb): Promise<User | null> {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.username, HOUSE_USERNAME))
      .limit(1);
    return rows[0] ?? null;
  }

  /** La wallet de la Casa. Tira `HouseNotProvisionedError` si no existe. */
  async getHouseWallet(db: TenantDb): Promise<Wallet> {
    const user = await this.getHouseUser(db);
    if (!user) throw new HouseNotProvisionedError();
    const rows = await db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, user.id))
      .limit(1);
    const wallet = rows[0];
    if (!wallet) throw new HouseNotProvisionedError();
    return wallet;
  }

  /** Estado de la Casa para el panel de tesorería. */
  async getHouseState(db: TenantDb): Promise<HouseState> {
    const user = await this.getHouseUser(db);
    if (!user) throw new HouseNotProvisionedError();
    const wallet = await this.getHouseWallet(db);
    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      balance: wallet.balance,
      lockedBalance: wallet.lockedBalance,
    };
  }
}
