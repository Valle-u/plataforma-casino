/**
 * A qué panel pertenece una ruta — admin o jugador.
 *
 * Las dos sesiones conviven en el mismo origen con cookies distintas
 * (`casino_admin_*` / `casino_player_*`), así que **cada request tiene que
 * saber de cuál de las dos está hablando**. La respuesta se saca del path, y
 * tres lugares la necesitan:
 *
 *   - `middleware.ts` — qué par de cookies refrescar.
 *   - `api-client.ts` — el header `X-Panel` de cada llamada.
 *   - `auth-context.tsx` — qué sesión bootstrapear.
 *
 * Vive suelta y sin imports para que la puedan usar las tres, incluido el
 * edge, sin arrastrar nada detrás.
 *
 * ⚠️ **`/r/` cuenta como ruta de jugador.** Es la landing de los links de
 * referido, que se comparten con usuarios finales. Quedó del lado admin por
 * omisión —la regla era "todo lo que no sea `/play` es panel"— y eso hacía que
 * `AuthProvider` arrancara ahí bootstrapeando la sesión equivocada: al
 * visitante con cuenta lo daba por deslogueado, y un instante después, ya en
 * `/play`, aparecía como logueado. En el medio se le abría el formulario de
 * registro encima de su propio lobby (2026-09-09).
 */
export function panelDeLaRuta(pathname: string): 'admin' | 'player' {
  return pathname.startsWith('/play') || pathname.startsWith('/r/')
    ? 'player'
    : 'admin';
}
