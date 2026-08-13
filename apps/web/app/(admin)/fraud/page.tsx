/**
 * /fraud — redirige a /integrity (se fusionó en "Integridad y seguridad").
 * Se mantiene la ruta para no romper bookmarks/links viejos.
 */

import { redirect } from 'next/navigation';

export default function FraudRedirect() {
  redirect('/integrity');
}
