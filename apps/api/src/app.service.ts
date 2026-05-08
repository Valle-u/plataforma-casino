/**
 * Service raíz.
 *
 * Un service en NestJS contiene la "lógica de negocio" — lo que realmente
 * hace algo útil. Los controllers solo reciben/devuelven HTTP, los services hacen
 * el trabajo de verdad (calcular, leer DB, llamar APIs externas, etc.).
 *
 * Esta separación se llama Single Responsibility:
 *   - controller = "qué endpoint atiende"
 *   - service    = "qué lógica ejecuta"
 *
 * @Injectable() es un decorador que le dice a NestJS:
 *   "esta clase puede ser inyectada como dependencia en otras clases".
 */

import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return '🎰 Plataforma Casino — API funcionando. Ver /health para estado del servicio.';
  }
}
