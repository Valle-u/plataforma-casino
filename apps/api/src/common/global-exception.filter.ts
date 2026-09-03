/**
 * GlobalExceptionFilter — Sprint 51.10.
 *
 * Captura TODA exception no manejada y:
 *   1. Loguea con stack + request context SANITIZADO (sin passwords,
 *      tokens, cookies, recovery codes, etc.).
 *   2. Devuelve al cliente la response normal de NestJS (`HttpException`
 *      mantiene su status; el resto cae a 500 INTERNAL_SERVER_ERROR).
 *
 * Antes:
 *   - Sin filter custom, NestJS imprime el body de la request en stack
 *     traces de 5xx por default — incluyendo `password`, `token`, etc.
 *   - El error log iba a stdout sin redaction.
 *
 * Ahora:
 *   - Filter intercepta, redacta body/headers/query/params via
 *     `redactHttpRequest`, y loguea solo lo sanitizado.
 *   - Response al cliente sin cambios (no se cambia el contrato HTTP).
 *
 * NO loguea HttpException 4xx por default (esos son errores "esperados"
 * — DTO inválido, 401, 403, 404) — solo 5xx + no-HttpException. Para
 * debug temporal, setear `LOG_ALL_EXCEPTIONS=1`.
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { extractRequestContext } from '../request-context/request-context';
import { redactHttpRequest } from './redact';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GlobalExceptionFilter');
  private readonly logAll =
    process.env.LOG_ALL_EXCEPTIONS === '1' ||
    process.env.LOG_ALL_EXCEPTIONS === 'true';

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const shouldLog = !isHttpException || status >= 500 || this.logAll;

    // El `request_id` que sirve es el que GENERA `RequestContextMiddleware`
    // (UUIDv7), porque es el mismo que queda en `audit_log.request_id`.
    //
    // ⚠️ Antes acá se leía `x-request-id` del request ENTRANTE — un header que
    // ningún cliente nuestro manda. El tag de Sentry y el `requestId` del log
    // salían vacíos **siempre**, y con eso se perdía la única forma de cruzar un
    // error con su fila de auditoría. El middleware lo devuelve en la respuesta
    // (`X-Request-Id`), no lo espera en la entrada.
    const requestId = extractRequestContext(request).requestId;

    // Enviar 5xx y errores no-Http a Sentry
    if (status >= 500) {
      Sentry.withScope((scope) => {
        scope.setTag('http.method', request.method);
        scope.setTag('http.url', request.originalUrl ?? request.url);
        scope.setTag('http.status_code', String(status));
        if (requestId) scope.setTag('request_id', requestId);
        scope.setExtra('query', request.query);
        scope.setExtra('params', request.params);
        Sentry.captureException(exception instanceof Error ? exception : new Error(String(exception)));
      });
    }

    if (shouldLog) {
      const safeReq = redactHttpRequest({
        body: request.body as unknown,
        headers: request.headers,
        query: request.query,
        params: request.params,
      });
      const meta = {
        method: request.method,
        url: request.originalUrl ?? request.url,
        status,
        requestId,
        ...safeReq,
      };
      const stack =
        exception instanceof Error
          ? exception.stack
          : new Error(String(exception)).stack;
      const message =
        exception instanceof Error
          ? exception.message
          : String(exception);
      // Format estable single-line — útil para grep en stdout/journalctl.
      this.logger.error(
        `[${request.method} ${meta.url}] ${status} - ${message} | ctx=${JSON.stringify(meta)}`,
        stack,
      );
    }

    // Response al cliente: respetamos el shape de NestJS.
    if (isHttpException) {
      const httpResponse = exception.getResponse();
      response
        .status(status)
        .json(
          typeof httpResponse === 'string'
            ? { statusCode: status, message: httpResponse }
            : httpResponse,
        );
    } else {
      response.status(status).json({
        statusCode: status,
        message: 'Internal server error',
      });
    }
  }
}
