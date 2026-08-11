/**
 * /users/:id/wallet — redirect de compatibilidad.
 *
 * La wallet del usuario se unificó dentro del perfil (docs/21 §4, Parte B):
 * vive como la pestaña "Wallet" de /users/:id. Mantenemos esta ruta para no
 * romper links viejos.
 */

import { redirect } from 'next/navigation';

export default async function UserWalletRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/users/${id}?tab=wallet`);
}
