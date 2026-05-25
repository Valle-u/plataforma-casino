/**
 * global-error.tsx — Sprint 53.3.
 *
 * Catastrophic root error boundary. Captura errores que rompen el
 * RootLayout — son los peores casos posibles (provider crash, fetch
 * de tenant info catastrófico, etc.).
 *
 * Reglas Next.js App Router:
 *   - Debe incluir <html> + <body> propios (reemplaza el root layout).
 *   - No puede importar styles de tenant theming porque el AuthProvider/
 *     TenantInfoProvider justamente puede ser lo que falló.
 *   - Mantenemos los styles mínimos inline + Tailwind del bundle base.
 *
 * UX:
 *   - Mensaje crudo + opción de reintentar + link a /login.
 *   - Log del error a console + (futuro: Sentry hook).
 */

'use client';

import { useEffect } from 'react';
import './globals.css';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // En producción: window.Sentry?.captureException(error)
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          backgroundColor: '#0a0a0a',
          color: '#fafafa',
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: '480px',
            border: '1px solid #262626',
            backgroundColor: '#121212',
            padding: '32px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
              color: '#f87171',
              fontWeight: 500,
            }}
          >
            Error fatal
          </div>
          <h1
            style={{
              fontSize: '28px',
              fontWeight: 600,
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Algo salió mal
          </h1>
          <p style={{ fontSize: '13px', color: '#a1a1a1', lineHeight: 1.55, margin: 0 }}>
            Encontramos un error inesperado y no pudimos cargar la página.
            Probá refrescar; si el problema persiste, contactá soporte
            mencionando el ID de abajo.
          </p>
          {error.digest && (
            <div
              style={{
                fontSize: '11px',
                fontFamily: 'monospace',
                color: '#8a8a8a',
                padding: '8px 12px',
                backgroundColor: '#1a1a1a',
                border: '1px solid #262626',
              }}
            >
              ID: {error.digest}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: '10px 16px',
                backgroundColor: '#dc2626',
                color: '#ffffff',
                border: 'none',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Reintentar
            </button>
            <a
              href="/login"
              style={{
                padding: '10px 16px',
                backgroundColor: '#1a1a1a',
                color: '#fafafa',
                border: '1px solid #3d3d3d',
                fontSize: '13px',
                fontWeight: 500,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Ir al login
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
