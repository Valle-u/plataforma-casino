/**
 * /red-mapa — ruta temporal del rediseño. Ya reemplazó a /red, así que
 * redirige ahí (compat con enlaces/bookmarks viejos).
 */

import { redirect } from 'next/navigation';

export default function RedMapaRedirect() {
  redirect('/red');
}
