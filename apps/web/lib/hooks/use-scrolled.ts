/**
 * `useScrolled` — ¿la página está scrolleada más de N píxeles?
 *
 * Existe porque los dos headers del jugador (el de mobile y el de desktop)
 * flotan sin fondo sobre el banner del home. Eso funcionaba mientras el header
 * se iba con el scroll: nunca llegaba a taparse con nada. Desde que quedan
 * fijos, el contenido les pasa por debajo y sin fondo se ve todo encimado —
 * los chips de categoría aparecían cortados atrás de los botones.
 *
 * Devuelve un booleano, no la posición: así el componente se vuelve a renderizar
 * dos veces (al cruzar el umbral y al volver), y no en cada píxel.
 *
 * ⚠️ Al pintar el fondo que depende de esto, **no uses `transition-colors`**.
 * Chrome no sabe interpolar de `transparent` al `color-mix()` que Tailwind
 * genera para cosas como `bg-[var(--color-bg)]/85`, y se queda clavado en
 * transparente: el header termina sin fondo, que es justo lo que se quería
 * arreglar. El corte seco además se lee mejor — es un cambio de estado, no una
 * animación.
 */

'use client';

import { useEffect, useState } from 'react';

/**
 * Umbral por defecto, en píxeles.
 *
 * Chico a propósito. Lo "natural" sería atarlo al alto del banner para que el
 * header flote encima todo lo que dura, pero eso lo acopla a otro componente y
 * se rompe **en silencio** justo cuando no hay banner (un tenant sin slides:
 * `LobbyBanner` devuelve `null`). Con un umbral chico el header se vuelve
 * sólido apenas te movés, que es exactamente cuando hace falta, y el efecto
 * flotante se conserva donde importa: al llegar a la página.
 */
export const SCROLL_THRESHOLD_PX = 12;

export function useScrolled(threshold: number = SCROLL_THRESHOLD_PX): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    // Se evalúa una vez al montar: si la página viene restaurada a mitad de
    // scroll (volver atrás en el navegador), el header ya tiene que salir
    // sólido en el primer pintado.
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return scrolled;
}
