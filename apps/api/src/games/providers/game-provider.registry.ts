/**
 * Registry de game providers — DI por providerCode.
 *
 * Registrados: 'palace' (Palace Casino) y 'forever' (Forever). Para agregar un
 * proveedor: inyectarlo en el constructor y hacer `this.providers.set(x.code, x)`.
 * Throw explícito si un game referencia un providerCode no registrado (mejor
 * fallar fuerte que silenciosamente).
 */

import { Injectable } from '@nestjs/common';
import { PalaceGameProvider } from './palace/palace-game-provider';
import { ForeverGameProvider } from './forever/forever-game-provider';
import type { IGameProvider } from './game-provider.interface';

export class UnknownProviderError extends Error {
  constructor(public readonly providerCode: string) {
    super(
      `Game provider '${providerCode}' no está registrado. Verificá GameProviderRegistry.`,
    );
    this.name = 'UnknownProviderError';
  }
}

@Injectable()
export class GameProviderRegistry {
  private readonly providers = new Map<string, IGameProvider>();

  constructor(palace: PalaceGameProvider, forever: ForeverGameProvider) {
    this.providers.set(palace.code, palace);
    this.providers.set(forever.code, forever);
  }

  get(providerCode: string): IGameProvider {
    const p = this.providers.get(providerCode);
    if (!p) throw new UnknownProviderError(providerCode);
    return p;
  }
}
