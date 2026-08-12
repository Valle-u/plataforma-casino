/**
 * /r/[code] — landing de un link de referido (base o campaña).
 *
 * Es el destino de los links que se comparten (`/r/<code>`). Hace dos cosas:
 *   1. Registra el click (POST /tenant/referrals/track-click/<code>) — best
 *      effort, no bloquea la redirección si falla.
 *   2. Redirige a `/play?auth=register&ref=<code>` para que el modal de
 *      registro se abra con el código pre-cargado (la atribución se hace al
 *      registrarse, en el backend).
 *
 * El tenant lo resuelve el api-client por el host configurado en el build
 * (no por el hostname del navegador), así que funciona igual desde una URL
 * de preview de Vercel.
 */

'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api-client';

export default function ReferralLandingPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = params?.code ?? '';

  useEffect(() => {
    if (!code) {
      router.replace('/play');
      return;
    }
    // Track click (best effort — ignoramos errores para no bloquear el flujo).
    void apiPost(`/tenant/referrals/track-click/${encodeURIComponent(code)}`)
      .catch(() => {})
      .finally(() => {
        router.replace(
          `/play?auth=register&ref=${encodeURIComponent(code)}`,
        );
      });
  }, [code, router]);

  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center"
      style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}
    >
      <div className="flex items-center gap-3 text-sm">
        <span className="size-4 border-2 border-current border-r-transparent animate-spin rounded-full" />
        Redirigiendo…
      </div>
    </div>
  );
}
