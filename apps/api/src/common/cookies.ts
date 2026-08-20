/**
 * Lectura de cookies sin dependencias.
 *
 * Express NO parsea el header `Cookie` por default y el proyecto no usa
 * `cookie-parser` (evitamos sumar middleware global + una dependencia para leer
 * una sola cookie). Este helper parsea el header a demanda.
 *
 * Contexto: migración del token de sesión de localStorage a cookie httpOnly.
 * Los guards leen `casino_{panel}_at` como fallback cuando no viene el header
 * `Authorization: Bearer` (ver tenant-jwt.guard). La cookie la setea la capa
 * BFF de Next; el rewrite reenvía el header `Cookie` al backend.
 */

import type { Request } from 'express';

/**
 * Devuelve el valor de la cookie `name` del header `Cookie`, o `undefined`.
 * Hace `decodeURIComponent` del valor (los JWT en base64url no lo necesitan,
 * pero es lo correcto para cookies en general).
 */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/**
 * Resuelve el panel activo (admin | player) desde el header `X-Panel`.
 * Default `admin`. Se usa para elegir cuál de las dos cookies de sesión
 * (admin/player, que conviven en el mismo origen) leer.
 */
export function panelFromRequest(req: Request): 'admin' | 'player' {
  return req.header('x-panel') === 'player' ? 'player' : 'admin';
}
