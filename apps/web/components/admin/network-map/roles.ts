/**
 * Paleta categórica del mapa de red (Fase 1). Un color distinto por rol para
 * leer la jerarquía de un vistazo, sobre fondo oscuro. Ajustable.
 *
 *   La Casa (raíz)  → dorado cálido   (origen de las fichas)
 *   admin_tenant    → ámbar
 *   socio           → esmeralda
 *   distribuidor    → celeste
 *   cajero          → violeta
 *   usuario_final   → gris pizarra
 *   (empleado: no se muestra en el mapa; fallback definido igual)
 */

import {
  Crown,
  Landmark,
  Store,
  Briefcase,
  Wallet,
  User,
  Users,
  Shield,
  type LucideIcon,
} from 'lucide-react';

export interface RoleStyle {
  icon: LucideIcon;
  /** Color de acento (ícono, borde izquierdo, glow). */
  color: string;
  label: string;
}

export const CASA_STYLE: RoleStyle = {
  icon: Landmark,
  color: '#F5D06B',
  label: 'La Casa',
};

export const PLAYERS_STYLE: RoleStyle = {
  icon: Users,
  color: '#64748B',
  label: 'Jugadores',
};

export const ROLE_STYLES: Record<string, RoleStyle> = {
  admin_tenant: { icon: Crown, color: '#F59E0B', label: 'Admin' },
  socio: { icon: Store, color: '#34D399', label: 'Socio' },
  distribuidor: { icon: Briefcase, color: '#38BDF8', label: 'Distribuidor' },
  cajero: { icon: Wallet, color: '#A78BFA', label: 'Cajero' },
  usuario_final: { icon: User, color: '#94A3B8', label: 'Jugador' },
  empleado: { icon: Shield, color: '#F472B6', label: 'Empleado' },
};

const DEFAULT_STYLE: RoleStyle = {
  icon: User,
  color: '#94A3B8',
  label: 'Usuario',
};

export function roleStyle(code: string): RoleStyle {
  return ROLE_STYLES[code] ?? DEFAULT_STYLE;
}

/** Para leyenda / filtros: orden jerárquico de roles comerciales. */
export const ROLE_ORDER: string[] = [
  'admin_tenant',
  'socio',
  'distribuidor',
  'cajero',
  'usuario_final',
];
