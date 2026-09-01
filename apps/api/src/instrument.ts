/**
 * Inicialización de Sentry. **Tiene que ser el PRIMER import de `main.ts`.**
 *
 * Por qué vive en su propio archivo y no adentro de `main.ts`:
 *
 * `Sentry.init()` no alcanza con llamarlo "temprano" — tiene que correr antes
 * de que se carguen los módulos que va a instrumentar. Los `import` de un
 * módulo se evalúan TODOS antes que su cuerpo, así que un `Sentry.init()`
 * escrito en el cuerpo de `main.ts` corre recién después de que Express, `pg` e
 * `ioredis` ya están cargados. La auto-instrumentación de OpenTelemetry parchea
 * los módulos en el momento en que se los requiere: si llega tarde, no parchea
 * nada y quedan sin tracing las requests HTTP, las queries y Redis.
 *
 * Poniéndolo en un archivo aparte e importándolo primero, este cuerpo corre
 * antes que cualquier otro import de la app.
 *
 * Si `SENTRY_DSN` no está seteado, Sentry queda deshabilitado (no-op) y la app
 * arranca igual. Eso es lo que pasa en desarrollo.
 */
import * as Sentry from '@sentry/nestjs';

/** Campos que nunca deben salir del server, ni en un reporte de error. */
const SENSIBLES = ['password', 'token', 'secret', 'authorization', 'cookie'];

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    sendDefaultPii: false,
    beforeSend(event) {
      // Redactar datos sensibles antes de enviar
      if (event.request?.data) {
        for (const key of SENSIBLES) {
          if (typeof event.request.data === 'object' && event.request.data !== null) {
            const data = event.request.data as Record<string, unknown>;
            if (key in data) data[key] = '[REDACTED]';
          }
        }
      }
      return event;
    },
  });

  // Smoke test del monitoreo, apagado por default.
  //
  // El problema de un sistema de alertas es que su falla es silenciosa: si el
  // DSN quedó mal o el contenedor no tiene salida a internet, no te enterás
  // hasta el día que pasa algo y no llega nada. Con `SENTRY_BOOT_PING=1` el
  // arranque manda un mensaje de prueba: si aparece en Sentry, el camino
  // completo funciona. Se prende para verificar y se vuelve a apagar.
  if (['1', 'true', 'yes'].includes((process.env.SENTRY_BOOT_PING ?? '').trim().toLowerCase())) {
    Sentry.captureMessage('boot ping — verificación de monitoreo', 'info');
  }
}
