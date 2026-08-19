/**
 * ProviderBackendRegistry — DI de los `IProviderBackend` por `code`.
 *
 * Mismo patrón que `GameProviderRegistry` (el del ciclo de juego), pero para el
 * backend de ADMINISTRACIÓN del proveedor (config/test/sync/diagnose).
 *
 * Para agregar un proveedor: inyectar su backend en el constructor y hacer
 * `this.backends.set(x.code, x)`. Nada más del `GameProvidersService` cambia.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { PalaceProviderBackend } from './palace/palace-provider-backend';
import type { IProviderBackend } from './provider-backend.interface';

@Injectable()
export class ProviderBackendRegistry {
  private readonly backends = new Map<string, IProviderBackend>();

  constructor(palace: PalaceProviderBackend) {
    this.backends.set(palace.code, palace);
  }

  /** Backend de `code`, o 404 si no está registrado. */
  get(code: string): IProviderBackend {
    const backend = this.backends.get(code);
    if (!backend) {
      throw new NotFoundException(`Proveedor desconocido: ${code}`);
    }
    return backend;
  }

  /** ¿`code` es un proveedor registrado? */
  has(code: string): boolean {
    return this.backends.has(code);
  }

  /** Todos los backends registrados (para listar). */
  list(): IProviderBackend[] {
    return [...this.backends.values()];
  }
}
