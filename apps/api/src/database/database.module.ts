/**
 * DatabaseModule — provee el cliente Drizzle conectado a la DB de control.
 *
 * Es un módulo "global" (vía @Global()), lo que significa que cualquier otro
 * módulo de la app puede inyectar `CONTROL_DB` sin tener que importar este
 * módulo en sus `imports`.
 *
 * Patrón de inyección:
 *   constructor(@Inject(CONTROL_DB) private readonly db: ControlDb) {}
 *
 * En MVP early solo proveemos el cliente de control. Cuando agreguemos
 * multi-tenant operacional, vamos a sumar un factory para clientes de tenant
 * (con pool de pools LRU según docs/13-escalabilidad.md §6.2).
 */

import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createControlDb, type ControlDb } from '@casino/db';
import { CONTROL_DB } from '../common/symbols';
export { CONTROL_DB };

/** Acceso al cliente postgres-js subyacente para shutdown limpio. */
interface DrizzleWithClient {
  $client: { end: () => Promise<void> };
}

@Global()
@Module({
  providers: [
    {
      provide: CONTROL_DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ControlDb => {
        const url = config.get<string>('DATABASE_URL_CONTROL');
        if (!url) {
          throw new Error(
            'DATABASE_URL_CONTROL no está definido. Verificá apps/api/.env.local',
          );
        }
        return createControlDb(url);
      },
    },
  ],
  exports: [CONTROL_DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(CONTROL_DB) private readonly db: ControlDb) {}

  /**
   * Cierra el pool de postgres-js al apagar la app. Llamado por NestJS en
   * shutdown (SIGTERM/SIGINT) y por `app.close()` en tests.
   */
  async onApplicationShutdown(): Promise<void> {
    await (this.db as unknown as DrizzleWithClient).$client.end();
  }
}
