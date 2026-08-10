/**
 * Tipos/helpers compartidos de Mi cuenta (docs/21-plan-perfil-wallet.md).
 *
 * Vive en un módulo sin 'use client' para que tanto el Server Component
 * (/play/account/page.tsx) como el client component (AccountTabs) puedan
 * usarlo sin violar la frontera server/client.
 */

export type AccountTab = 'perfil' | 'dinero' | 'movimientos' | 'seguridad';

export function isAccountTab(value: string | undefined): value is AccountTab {
  return value === 'perfil' || value === 'dinero' || value === 'movimientos' || value === 'seguridad';
}
