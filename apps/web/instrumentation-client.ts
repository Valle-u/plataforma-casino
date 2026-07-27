import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: process.env.NODE_ENV === 'production' ? 0.5 : 1.0,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.request?.data) {
      const sensitive = ['password', 'token', 'secret', 'authorization', 'cookie'];
      for (const key of sensitive) {
        if (typeof event.request.data === 'object' && event.request.data !== null) {
          const data = event.request.data as Record<string, unknown>;
          if (key in data) data[key] = '[REDACTED]';
        }
      }
    }
    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
