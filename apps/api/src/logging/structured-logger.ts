/**
 * StructuredLogger — el logger de la API, con `request_id` en cada línea.
 *
 * ## Qué resuelve
 *
 * Antes los logs salían en texto plano y sin forma de correlacionarlos. Buscar
 * "qué pasó en este request" era `grep` sobre texto, y encima sobre logs que se
 * borran (ver `docs/26-monitoreo-diagnostico.md` §4.1).
 *
 * Ahora cada línea es un JSON con `request_id`, y ese id es **el mismo** que
 * queda en `audit_log.request_id` y el que se le manda a Sentry. Un error, su
 * fila de auditoría y sus logs se cruzan por un solo valor.
 *
 * ## Cómo se enchufa sin tocar 325 llamadas
 *
 * Implementa `LoggerService` de NestJS y se instala con `app.useLogger()`. Todo
 * el código sigue llamando a `this.logger.log(...)` como siempre; lo que cambia
 * es a dónde va y con qué forma. El `request_id` lo saca del
 * `AsyncLocalStorage` de `RequestContextMiddleware`, no de un parámetro.
 *
 * ## Formato según entorno
 *
 * - **Producción**: una línea JSON, para que se pueda buscar por campo.
 * - **Desarrollo**: texto legible, porque nadie quiere leer JSON en su terminal.
 *
 * ⚠️ **La redacción es por clave, no por contenido.** `redactSensitive` tapa
 * valores cuya CLAVE es sensible (`password`, `token`, `secret`…). Si alguien
 * interpola un secreto dentro del string del mensaje —`logger.log(\`token=${t}\`)`—
 * eso sale tal cual. No es nuevo, pero ahora los logs viajan a un tercero, así
 * que importa más: **el mensaje se escribe sin datos sensibles adentro**.
 */

import type { LoggerService, LogLevel } from '@nestjs/common';
import { redactSensitive } from '../common/redact';
import { currentRequestContext } from '../request-context/request-context';
import type { AxiomTransport } from './axiom-transport';

/** Los niveles que emitimos, mapeados a lo que se lee en Axiom. */
type Nivel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

const NIVEL_POR_METODO: Record<string, Nivel> = {
  log: 'info',
  error: 'error',
  warn: 'warn',
  debug: 'debug',
  verbose: 'verbose',
};

export class StructuredLogger implements LoggerService {
  private readonly json: boolean;

  constructor(
    private readonly transport: AxiomTransport | null,
    json = process.env.NODE_ENV === 'production',
  ) {
    this.json = json;
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.emitir('log', message, rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.emitir('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.emitir('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.emitir('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.emitir('verbose', message, rest);
  }

  /** NestJS lo llama para saber si un nivel está prendido. */
  setLogLevels?(_levels: LogLevel[]): void {
    // El filtrado por nivel lo hace NestJS antes de llamarnos.
  }

  private emitir(metodo: string, message: unknown, rest: unknown[]): void {
    const nivel = NIVEL_POR_METODO[metodo] ?? 'info';

    // NestJS manda el `context` (el nombre de la clase) como ÚLTIMO argumento
    // string. Cuando es `error`, antes puede venir el stack.
    const { context, extras } = this.separar(rest);

    const ctx = currentRequestContext();
    const evento: Record<string, unknown> = {
      _time: new Date().toISOString(),
      level: nivel,
      context: context ?? null,
      message: typeof message === 'string' ? message : safeString(message),
    };

    if (ctx) {
      evento.request_id = ctx.requestId;
      if (ctx.sessionId) evento.session_id = ctx.sessionId;
      if (ctx.impersonatorId) evento.impersonator_id = ctx.impersonatorId;
    }
    if (extras.length > 0) {
      evento.extra = redactSensitive(extras.length === 1 ? extras[0] : extras);
    }

    this.escribir(nivel, evento);
    this.transport?.encolar(evento);
  }

  /**
   * Separa el `context` de NestJS del resto.
   *
   * La convención es que el último string sea el nombre de la clase. No es
   * infalible —un `logger.log('a', 'b')` deja 'b' como context— pero es la
   * misma heurística que usa el logger que viene de fábrica.
   */
  private separar(rest: unknown[]): { context?: string; extras: unknown[] } {
    if (rest.length === 0) return { extras: [] };
    const ultimo = rest[rest.length - 1];
    if (typeof ultimo === 'string' && !ultimo.includes('\n')) {
      return { context: ultimo, extras: rest.slice(0, -1) };
    }
    return { extras: rest };
  }

  private escribir(nivel: Nivel, evento: Record<string, unknown>): void {
    const salida = nivel === 'error' || nivel === 'warn' ? console.error : console.log;

    if (this.json) {
      salida(JSON.stringify(evento));
      return;
    }

    // Desarrollo: legible. El request_id se acorta — para correlacionar a ojo
    // en una terminal alcanza con el final, que es la parte que varía.
    const rid = typeof evento.request_id === 'string' ? evento.request_id : null;
    const donde = typeof evento.context === 'string' ? ` [${evento.context}]` : '';
    const id = rid ? ` [${rid.slice(-8)}]` : '';
    const extra = evento.extra ? ` ${safeString(evento.extra)}` : '';
    salida(`${nivel.toUpperCase()}${donde}${id} ${safeString(evento.message)}${extra}`);
  }
}

/** Serializa cualquier cosa sin tirar (los ciclos rompen `JSON.stringify`). */
function safeString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack ?? v.message;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}
