/**
 * Unit tests de la jerarquía de roles (`role-hierarchy.ts`).
 *
 * Cubre la regla que evita la escalada de privilegios al crear/asignar
 * roles: un actor solo puede asignar roles ESTRICTAMENTE por debajo del
 * suyo; el `admin_tenant` puede asignar cualquiera. Funciones puras — sin DB.
 */

import {
  actorRank,
  assignableRoleCodes,
  canAssignRole,
  ROLE_RANK,
} from './role-hierarchy';

describe('role-hierarchy', () => {
  describe('actorRank', () => {
    it('toma el rol de MAYOR privilegio (menor rank) en multi-rol', () => {
      expect(actorRank(['cajero', 'socio'])).toBe(ROLE_RANK.socio);
      expect(actorRank(['usuario_final', 'cajero'])).toBe(ROLE_RANK.cajero);
    });

    it('roles desconocidos → +Infinity (sin privilegio)', () => {
      expect(actorRank([])).toBe(Number.POSITIVE_INFINITY);
      expect(actorRank(['rol_inventado'])).toBe(Number.POSITIVE_INFINITY);
    });
  });

  describe('canAssignRole', () => {
    it('admin_tenant puede asignar cualquier rol conocido (incluido admin)', () => {
      for (const code of Object.keys(ROLE_RANK)) {
        expect(canAssignRole(['admin_tenant'], code)).toBe(true);
      }
    });

    it('admin_tenant pasa el guard aun con rol inexistente (lo valida el service → 400)', () => {
      expect(canAssignRole(['admin_tenant'], 'no_existe')).toBe(true);
    });

    it('un socio NO puede crear admin ni otro socio', () => {
      expect(canAssignRole(['socio'], 'admin_tenant')).toBe(false);
      expect(canAssignRole(['socio'], 'socio')).toBe(false);
    });

    it('un socio SÍ puede crear distribuidor, cajero, empleado y jugador', () => {
      expect(canAssignRole(['socio'], 'distribuidor')).toBe(true);
      expect(canAssignRole(['socio'], 'cajero')).toBe(true);
      expect(canAssignRole(['socio'], 'empleado')).toBe(true);
      expect(canAssignRole(['socio'], 'usuario_final')).toBe(true);
    });

    it('un cajero solo puede crear empleado y jugador (no ve la estructura hacia arriba)', () => {
      expect(canAssignRole(['cajero'], 'admin_tenant')).toBe(false);
      expect(canAssignRole(['cajero'], 'socio')).toBe(false);
      expect(canAssignRole(['cajero'], 'distribuidor')).toBe(false);
      expect(canAssignRole(['cajero'], 'empleado')).toBe(true);
      expect(canAssignRole(['cajero'], 'usuario_final')).toBe(true);
    });

    it('actor sin rol conocido no puede asignar nada (default deny)', () => {
      expect(canAssignRole([], 'usuario_final')).toBe(false);
      expect(canAssignRole(['rol_inventado'], 'usuario_final')).toBe(false);
    });

    it('rol target inexistente → false para no-admin', () => {
      expect(canAssignRole(['socio'], 'no_existe')).toBe(false);
    });
  });

  describe('assignableRoleCodes', () => {
    it('admin_tenant → todos los roles', () => {
      expect(assignableRoleCodes(['admin_tenant']).sort()).toEqual(
        Object.keys(ROLE_RANK).sort(),
      );
    });

    it('socio → solo lo que está por debajo', () => {
      expect(assignableRoleCodes(['socio'])).toEqual([
        'distribuidor',
        'cajero',
        'empleado',
        'usuario_final',
      ]);
    });

    it('cajero → solo empleado y jugador', () => {
      expect(assignableRoleCodes(['cajero'])).toEqual([
        'empleado',
        'usuario_final',
      ]);
    });
  });
});
