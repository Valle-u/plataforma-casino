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
 *   GET /health   → devuelve { status: "ok" } para chequear que la API está viva
 */

import { Controller, Get, Inject } from '@nestjs/common';
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
   */
  @Get('health')
  async getHealth(): Promise<HealthResponse> {
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

    return {
      status: overall,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: dbStatus,
      redis: redisStatus,
    };
  }
}
