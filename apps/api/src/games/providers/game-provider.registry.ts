/**
 * Registry de game providers — DI por providerCode.
 *
 * Sprint 35: solo 'mock' está registrado. Cuando llegue un provider
 * real, se agrega al map. Throw explícito si un game referencia un
 * providerCode no registrado (mejor fallar fuerte que silenciosamente).
 */

import { Injectable } from '@nestjs/common';
import { MockGameProvider } from './mock-game-provider';
import { PalaceGameProvider } from './palace/palace-game-provider';
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

  constructor(
    mock: MockGameProvider,
    palace: PalaceGameProvider,
  ) {
    this.providers.set(mock.code, mock);
    this.providers.set(palace.code, palace);
  }

  get(providerCode: string): IGameProvider {
    const p = this.providers.get(providerCode);
    if (!p) throw new UnknownProviderError(providerCode);
    return p;
  }
}
