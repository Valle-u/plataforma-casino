import { NextResponse } from 'next/server';

/**
 * Health endpoint liviano del frontend, para el healthcheck de Dokploy/Traefik.
 * No toca la API ni la DB — solo confirma que el server de Next responde. Se
 * marca dinámico para que no quede cacheado como estático en el build.
 */
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok', service: 'web' });
}
