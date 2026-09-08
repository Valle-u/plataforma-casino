/**
 * Pantalla de carga del jugador.
 *
 * **Lo que reemplaza.** Un `div` de 4×4 píxeles latiendo en el centro de una
 * pantalla negra. Con buena conexión no se veía; con mala, el jugador miraba
 * una página vacía con una mota — indistinguible de un sitio roto. Y en un
 * casino eso importa más que en otros lados: quien duda de si la página
 * funciona, duda de si su plata está bien.
 *
 * **Por qué un esqueleto y no un spinner.** Un spinner dice "esperá" y nada
 * más. Un esqueleto con la forma de lo que viene dice además *qué* viene, y
 * cuando el contenido llega ocupa el lugar que ya estaba reservado: no hay
 * salto. Reproduce la misma estructura que monta `PlayerLayout` — barra lateral
 * de 248px en desktop, banner a sangre y grilla de juegos.
 *
 * **Los colores ya son los del casino.** El servidor los deja resueltos en
 * `:root` antes del primer pintado (ver `server-tenant-theme`), así que esta
 * pantalla sale con la paleta del tenant y no con la genérica. Sin eso, el
 * esqueleto habría sido un parpadeo más.
 */

const CARDS = 12;

export function PlayerLoadingScreen() {
  return (
    <div
      className="flex min-h-screen bg-[var(--color-bg)]"
      role="status"
      aria-label="Cargando el casino"
    >
      {/* Barra lateral — solo desktop, igual que el shell real. */}
      <aside className="hidden h-screen w-[248px] shrink-0 flex-col gap-6 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4 lg:flex">
        <div className="h-8 w-32 animate-pulse rounded bg-[var(--color-bg-subtle)]" />
        <div className="flex flex-col gap-3">
          <div className="h-9 w-full animate-pulse rounded-[var(--radius)] bg-[var(--color-bg-subtle)]" />
          <div className="h-9 w-full animate-pulse rounded-[var(--radius)] bg-[var(--color-bg-subtle)]" />
        </div>
        <div className="mt-2 flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-7 w-full animate-pulse rounded bg-[var(--color-bg-subtle)]"
            />
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Banner: misma altura que el real, para que no salte al llegar. */}
        <div className="h-[372px] w-full animate-pulse bg-[var(--color-bg-subtle)] lg:h-[552px]" />

        {/* Franja de ganadores. */}
        <div className="h-9 w-full animate-pulse border-y border-[var(--color-border)] bg-[var(--color-bg-elevated)]" />

        <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <div className="h-6 w-40 animate-pulse rounded bg-[var(--color-bg-subtle)]" />
          <div className="h-11 w-full animate-pulse rounded-[var(--radius)] bg-[var(--color-bg-subtle)]" />

          {/* Grilla — mismas columnas que la real. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: CARDS }, (_, i) => (
              <div
                key={i}
                className="aspect-[4/3] animate-pulse rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)]"
                // Un desfasaje corto entre cards: latiendo todas al unísono se
                // lee como un bloque parpadeando, no como contenido llegando.
                style={{ animationDelay: `${(i % 6) * 90}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
