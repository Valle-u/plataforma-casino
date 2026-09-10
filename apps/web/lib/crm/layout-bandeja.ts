/**
 * El ancho de las columnas de la bandeja, y cómo se recuerda.
 *
 * El diseño pide tres columnas **redimensionables y colapsables por separado**,
 * con el layout persistido en `localStorage` bajo `crm.app.layout` — la misma
 * clave donde el shell guarda si el menú está colapsado.
 *
 * ## Por qué los topes no son decoración
 *
 * Una conversación de 200px no se puede leer y una lista de 900px no deja lugar
 * para nada. Los rangos salen del handoff y el piso de la conversación es el
 * más importante: **es la única columna que no se puede colapsar**, porque es
 * para lo que se abre la bandeja.
 *
 * ## Por qué esto vive suelto y no adentro del componente
 *
 * Porque lo leen dos cosas que corren en momentos distintos: el componente al
 * montar, y el arrastre en cada `mousemove`. Con los números adentro del render
 * habría que pasarlos por props o recalcularlos por frame.
 */

/** Dónde se guarda todo el layout de la app del CRM. */
export const CLAVE_LAYOUT = 'crm.app.layout';

/** Anchos por defecto, tal como los fija el handoff. */
export const ANCHOS = {
  lista: 348,
  ficha: 324,
} as const;

/** Rangos de arrastre. Fuera de esto, el arrastre no sigue. */
export const LIMITES = {
  lista: { min: 260, max: 520 },
  ficha: { min: 260, max: 460 },
  /**
   * Lo mínimo que puede quedarle a la conversación.
   *
   * No es un ancho que se elija: es el piso que respeta el arrastre de
   * cualquiera de las otras dos. Si al agrandar la lista la conversación
   * quedaría abajo de esto, el arrastre se frena.
   */
  conversacionMinima: 420,
} as const;

/** Ancho del riel que queda cuando una columna se colapsa. */
export const RIEL = 46;

export interface LayoutDeLaBandeja {
  /** ¿El menú lateral del shell está abierto? Lo escribe el shell. */
  nav?: boolean;
  /** ¿La lista de conversaciones está abierta? */
  lista: boolean;
  /** ¿La ficha del contacto está abierta? */
  ficha: boolean;
  anchoLista: number;
  anchoFicha: number;
  /** Filas más juntas: padding chico y sin etiquetas. */
  densa: boolean;
}

export const LAYOUT_POR_DEFECTO: LayoutDeLaBandeja = {
  lista: true,
  ficha: true,
  anchoLista: ANCHOS.lista,
  anchoFicha: ANCHOS.ficha,
  densa: false,
};

/** Recorta un ancho a su rango. */
export function acotar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

/**
 * Lee el layout guardado, **conservando lo que no entienda**.
 *
 * El objeto lo comparten el shell (`nav`) y la bandeja, así que leer y volver a
 * escribir sin cuidado le borraría al otro su parte. Por eso el resultado se
 * arma sobre lo que había.
 */
export function leerLayout(): LayoutDeLaBandeja {
  if (typeof window === 'undefined') return LAYOUT_POR_DEFECTO;
  try {
    const crudo = window.localStorage.getItem(CLAVE_LAYOUT);
    if (!crudo) return LAYOUT_POR_DEFECTO;
    const guardado = JSON.parse(crudo) as Partial<LayoutDeLaBandeja>;
    return {
      ...LAYOUT_POR_DEFECTO,
      ...guardado,
      // Los anchos se re-acotan al leer: un `localStorage` de una versión con
      // otros topes —o editado a mano— dejaría una columna imposible.
      anchoLista: acotar(
        Number(guardado.anchoLista) || ANCHOS.lista,
        LIMITES.lista.min,
        LIMITES.lista.max,
      ),
      anchoFicha: acotar(
        Number(guardado.anchoFicha) || ANCHOS.ficha,
        LIMITES.ficha.min,
        LIMITES.ficha.max,
      ),
    };
  } catch {
    return LAYOUT_POR_DEFECTO;
  }
}

/** Guarda el layout sin pisar las claves de otros (`nav`). */
export function guardarLayout(layout: LayoutDeLaBandeja): void {
  if (typeof window === 'undefined') return;
  try {
    const crudo = window.localStorage.getItem(CLAVE_LAYOUT);
    const previo = crudo ? (JSON.parse(crudo) as Record<string, unknown>) : {};
    window.localStorage.setItem(
      CLAVE_LAYOUT,
      JSON.stringify({ ...previo, ...layout }),
    );
  } catch {
    /* que no se pueda recordar no es motivo para que no se pueda mover */
  }
}
