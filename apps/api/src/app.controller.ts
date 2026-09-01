/**
 * Controller raíz.
 *
 * Un controller en NestJS recibe pedidos HTTP y los rutea a la lógica
 * correspondiente (que vive en services).
 *
 * Los decoradores son las anotaciones que empiezan con @:
 *   @Controller(...)  → marca esta clase como controller y define el path base.
 *   @Get(...)         → marca un método como handler de GET.
 *
 * Acá tenemos solo dos endpoints simples:
 *   GET /         → devuelve "Hola desde la plataforma de casino"
 *   GET /health   → chequeo de vida; 503 si algo está caído (ver getHealth)
 */

import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sql } from 'drizzle-orm';
import { AppService } from './app.service';
import { CONTROL_DB } from './database/database.module';
import { RedisService } from './redis/redis.service';
import type { ControlDb } from '@casino/db';

interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptime: number;
  db: 'connected' | 'error';
  redis: 'connected' | 'disabled' | 'error';
}

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    @Inject(CONTROL_DB) private readonly db: ControlDb,
    private readonly redis: RedisService,
  ) {}

  /**
   * GET /
   * Saludo de bienvenida.
   */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * GET /health
   * Health check con chequeo de DB y Redis.
   * Redis es opcional: si no está configurado, reporta "disabled".
   * Intencionalmente NO expone versión de Postgres ni info sensible.
   *
   * **Devuelve 503 cuando el estado es `degraded`**, no 200. Suena a
   * detalle pero es lo que hace útil al monitor de uptime: chequea el
   * status code, no el body. Con 200 fijo, un monitor externo reportaba
   * "todo bien" con la base de datos caída.
   *
   * Un Redis caído también da 503 aunque la app siga sirviendo. Es
   * deliberado: el cache está en el camino de varios endpoints y no está
   * verificado que TODOS degraden sin romper. Preferimos que avise de más
   * a enterarnos por un jugador.
   *
   * `redis: 'disabled'` (no configurado) NO es degradado — es desarrollo.
   */
  @Get('health')
  async getHealth(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthResponse> {
    let dbStatus: 'connected' | 'error' = 'connected';
    try {
      await this.db.execute(sql`SELECT 1`);
    } catch {
      dbStatus = 'error';
    }

    let redisStatus: 'connected' | 'disabled' | 'error' = 'disabled';
    if (this.redis.isEnabled()) {
      try {
        await this.redis.set('health:ping', 'pong', 10);
        const pong = await this.redis.get<string>('health:ping');
        redisStatus = pong === 'pong' ? 'connected' : 'error';
      } catch {
        redisStatus = 'error';
      }
    }

    const overall: 'ok' | 'degraded' =
      dbStatus === 'connected' && redisStatus !== 'error' ? 'ok' : 'degraded';

    res.status(overall === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: overall,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: dbStatus,
      redis: redisStatus,
    };
  }
}
