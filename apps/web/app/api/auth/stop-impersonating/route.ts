/**
 * BFF POST /api/auth/stop-impersonating — vuelve de un impersonate.
 *
 * El panel actual (header `X-Panel`) es el panel impersonado. Si hay backup
 * `casino_orig_*`, restaura esa sesión; si no había sesión previa en ese panel
 * (ej. el admin impersonó a un jugador sin tener sesión de jugador propia), la
 * limpia. La sesión "casa" del admin (casino_admin_*) sigue intacta o restaurada,
 * así el cliente puede recargar a /dashboard y volver a ser el admin.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  clearBackup,
  clearSessionCookies,
  cookieNames,
  panelFrom,
  setSessionCookies,
} from '@/lib/auth-cookies';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const panel = panelFrom(req.headers.get('x-panel'));
  const names = cookieNames(panel);
  const origAt = req.cookies.get(names.origAt)?.value;
  const origRt = req.cookies.get(names.origRt)?.value;

  const res = NextResponse.json({ ok: true, restored: Boolean(origAt && origRt) });

  if (origAt && origRt) {
    // Restaurar la sesión previa de este panel y borrar el backup.
    setSessionCookies(res, panel, origAt, origRt);
    clearBackup(res, panel);
  } else {
    // No había sesión previa en este panel → limpiar la del impersonado.
    clearSessionCookies(res, panel);
  }
  return res;
}
