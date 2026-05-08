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

import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  // Inyección de dependencias: NestJS automáticamente nos da la instancia
  // de AppService porque está registrado en AppModule como provider.
  constructor(private readonly appService: AppService) {}

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
   * Health check estándar. Devuelve estado del servicio + timestamp.
   * Más adelante lo expandimos con checks reales (DB, Redis, etc.).
   */
  @Get('health')
  getHealth(): { status: string; timestamp: string; uptime: number } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
