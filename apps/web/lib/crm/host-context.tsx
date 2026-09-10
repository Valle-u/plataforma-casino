/**
 * "¿Estoy en el host del CRM?", disponible desde el PRIMER render del cliente.
 *
 * ## Por qué hace falta un contexto y no alcanza con mirar el host
 *
 * El layout del panel es un componente de cliente (usa hooks de sesión), y en
 * el cliente la única forma de saber el host es `window.location` — que **no
 * existe durante el render del servidor**. O sea que el primer HTML se pintaría
 * con el shell del panel y recién al hidratar cambiaría al del CRM: el menú
 * entero parpadeando en cada carga.
 *
 * Ese parpadeo ya costó arreglarlo dos veces en este repo —la paleta del
 * jugador y el recorte del menú del CRM— y las dos veces la solución fue la
 * misma: **que la respuesta viaje desde el servidor**.
 *
 * Acá el valor lo resuelve `app/layout.tsx` leyendo el header que pone el
 * middleware, y baja por el árbol dentro del payload del servidor. Cuando React
 * hidrata, el primer render del cliente **ya sabe** cuál de los dos shells va.
 *
 * ⚠️ Esto elige la interfaz, no los permisos. Lo que impide llegar a otra
 * pantalla es el redirect del middleware, y lo que impide leer datos que no
 * corresponden son los permisos del backend.
 */

'use client';

import { createContext, useContext, type ReactNode } from 'react';

const Contexto = createContext(false);

export function HostDelCrmProvider({
  esCrm,
  children,
}: {
  esCrm: boolean;
  children: ReactNode;
}): React.ReactElement {
  return <Contexto.Provider value={esCrm}>{children}</Contexto.Provider>;
}

/**
 * `true` si la página se está sirviendo por `crm.` / `crm-`.
 *
 * Fuera del provider devuelve `false` — o sea, el panel completo. Es el lado
 * seguro: en el peor caso alguien ve el shell del panel en el CRM, no al revés.
 */
export function useEsHostDeCrm(): boolean {
  return useContext(Contexto);
}
