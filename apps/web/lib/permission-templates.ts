/**
 * Planillas ("templates") para crear empleados con permisos preconfigurados.
 *
 * Cada planilla es un set de permission codes que se otorgan por override
 * al crear el user (via el campo permissionOverrides del POST /tenant/users).
 * El admin puede ajustar el set antes de confirmar (agregar/quitar perms).
 *
 * Los codes se filtran por `useGrantableByMe()` en el front — si el admin
 * no puede delegar alguno del set, se omite del auto-tildado y se lista
 * al pie del modal para que el admin sepa qué queda afuera.
 *
 * Fuente única — mantener en sync con el catálogo del backend
 * (`packages/db/src/seeds/tenant-seed.ts`).
 */

export interface TemplatePermission {
  code: string;
  /** categoría lógica del rol dentro del negocio, para agrupar en la UI */
  categoria:
    | 'banco'
    | 'fichas'
    | 'trazabilidad'
    | 'bonos'
    | 'antifraude'
    | 'usuarios'
    | 'otros';
  /** true si sacarlo rompe la función central de la planilla */
  requerido: boolean;
}

export interface PermissionTemplate {
  id: string;
  nombre: string;
  descripcion: string;
  /** rol al que apunta la planilla — hoy siempre empleado */
  rol: string;
  permisos: TemplatePermission[];
  /**
   * Cupo mensual sugerido (docs/19) — hoy siempre '0'. El admin lo setea
   * después manualmente en tesorería si corresponde.
   */
  cupoMensualDefault: string;
  /** advertencia opcional que se muestra en el card informativo */
  caveat?: string;
}

export const PERMISSION_TEMPLATES: readonly PermissionTemplate[] = [
  {
    id: 'empleado-banco',
    nombre: 'Empleado de Banco (Depósitos y Retiros)',
    descripcion:
      'Trabaja con el extracto bancario: sube transferencias entrantes, matchea con depósitos y aprueba/rechaza depósitos y retiros de la red del admin. No toca la wallet directamente.',
    rol: 'empleado',
    cupoMensualDefault: '0',
    permisos: [
      { code: 'bank_tx.upload', categoria: 'banco', requerido: true },
      { code: 'bank_tx.view', categoria: 'banco', requerido: true },
      { code: 'bank_tx.match', categoria: 'banco', requerido: true },
      { code: 'bank_tx.edit', categoria: 'banco', requerido: false },
      { code: 'deposits.view_admin_network', categoria: 'banco', requerido: true },
      { code: 'deposits.approve_admin_network', categoria: 'banco', requerido: true },
      { code: 'deposits.reject_admin_network', categoria: 'banco', requerido: true },
      { code: 'deposits.export', categoria: 'banco', requerido: false },
      { code: 'withdrawals.view_admin_network', categoria: 'banco', requerido: true },
      { code: 'withdrawals.approve_admin_network', categoria: 'banco', requerido: true },
      { code: 'withdrawals.reject_admin_network', categoria: 'banco', requerido: true },
      { code: 'withdrawals.process_admin_network', categoria: 'banco', requerido: true },
      { code: 'withdrawals.export', categoria: 'banco', requerido: false },
      { code: 'wallet.view_admin_network', categoria: 'fichas', requerido: true },
      { code: 'users.view_admin_network', categoria: 'usuarios', requerido: true },
      { code: 'users.view_any', categoria: 'usuarios', requerido: true },
    ],
  },
  {
    id: 'empleado-caja-bonos',
    nombre: 'Empleado de Caja, Bonos y Promociones',
    descripcion:
      'Operatoria diaria del piso: carga/descarga de fichas a jugadores, correcciones contra el cupo mensual (docs/19), y gestión de bonos y promociones (otorgar, cancelar). El rol más amplio del piso operativo.',
    rol: 'empleado',
    cupoMensualDefault: '0',
    caveat:
      'Para que wallet.correct_admin_network funcione hay que asignarle un cupo mensual > 0 desde tesorería después de crearlo. Sin cupo, el permiso queda inerte.',
    permisos: [
      // Caja / fichas
      { code: 'wallet.load_admin_network', categoria: 'fichas', requerido: true },
      { code: 'wallet.unload_admin_network', categoria: 'fichas', requerido: true },
      { code: 'wallet.view_admin_network', categoria: 'fichas', requerido: true },
      { code: 'wallet.correct_admin_network', categoria: 'fichas', requerido: true },
      { code: 'wallet.export', categoria: 'fichas', requerido: false },
      // Solicitudes (aceptar/rechazar depósitos y retiros)
      { code: 'deposits.view_admin_network', categoria: 'banco', requerido: true },
      { code: 'deposits.approve_admin_network', categoria: 'banco', requerido: true },
      { code: 'deposits.reject_admin_network', categoria: 'banco', requerido: true },
      { code: 'withdrawals.view_admin_network', categoria: 'banco', requerido: true },
      { code: 'withdrawals.approve_admin_network', categoria: 'banco', requerido: true },
      { code: 'withdrawals.reject_admin_network', categoria: 'banco', requerido: true },
      { code: 'withdrawals.process_admin_network', categoria: 'banco', requerido: true },
      // Extracto bancario (para completar el flujo: subir bank_tx, matchear, aprobar)
      { code: 'bank_tx.view', categoria: 'banco', requerido: true },
      { code: 'bank_tx.upload', categoria: 'banco', requerido: true },
      { code: 'bank_tx.match', categoria: 'banco', requerido: true },
      // Bonos
      { code: 'bonuses.view', categoria: 'bonos', requerido: true },
      { code: 'bonuses.view_any', categoria: 'bonos', requerido: true },
      { code: 'bonuses.grant_manual_admin_network', categoria: 'bonos', requerido: true },
      { code: 'bonuses.cancel_admin_network', categoria: 'bonos', requerido: true },
      { code: 'bonuses.export', categoria: 'bonos', requerido: false },
      { code: 'bonuses.export_definitions', categoria: 'bonos', requerido: false },
      // Promociones (leagues.view/view_any y promotions.view_any están
      // en el catálogo pero ningún endpoint los enforcea — audit 2026-07;
      // los sacamos hasta que el módulo los implemente)
      { code: 'promotions.view', categoria: 'bonos', requerido: true },
      { code: 'promotions.export', categoria: 'bonos', requerido: false },
      // Usuarios (gate + admin network)
      { code: 'users.view_admin_network', categoria: 'usuarios', requerido: true },
      { code: 'users.view_any', categoria: 'usuarios', requerido: true },
    ],
  },
  {
    id: 'empleado-auditoria-antifraude',
    nombre: 'Empleado de Auditoría y Antifraude',
    descripcion:
      'Vigilancia interna: audita todo lo que se movió en la red del admin (wallet, juegos, netwin, notificaciones, audit log), revisa señales antifraude / clusters sospechosos y correlaciona la trazabilidad con el juego responsable. Exporta a CSV para conciliación. Nunca modifica estado monetario.',
    rol: 'empleado',
    cupoMensualDefault: '0',
    permisos: [
      // Auditoría / trazabilidad
      { code: 'wallet_stats.view_own_network', categoria: 'trazabilidad', requerido: true },
      { code: 'wallet_stats.export', categoria: 'trazabilidad', requerido: true },
      { code: 'game_stats.view_own_network', categoria: 'trazabilidad', requerido: true },
      { code: 'game_stats.export', categoria: 'trazabilidad', requerido: true },
      // reports.netwin.view y reports.export están en el catálogo pero
      // ningún endpoint los enforcea — audit 2026-07; los sacamos hasta
      // que se implemente el reporte de netwin y el export genérico.
      { code: 'audit.view', categoria: 'trazabilidad', requerido: true },
      { code: 'audit.export', categoria: 'trazabilidad', requerido: true },
      { code: 'notifications.view_any', categoria: 'trazabilidad', requerido: false },
      { code: 'notifications.export', categoria: 'trazabilidad', requerido: false },
      { code: 'branch.view', categoria: 'trazabilidad', requerido: false },
      { code: 'commissions.view', categoria: 'otros', requerido: false },
      // Antifraude y riesgo
      { code: 'fraud.view', categoria: 'antifraude', requerido: true },
      { code: 'fraud.review', categoria: 'antifraude', requerido: true },
      { code: 'fraud.run_scan', categoria: 'antifraude', requerido: true },
      { code: 'responsible_gaming.review', categoria: 'antifraude', requerido: true },
      // Read-only sobre red del admin (necesario para cruzar datos)
      { code: 'users.view_admin_network', categoria: 'usuarios', requerido: true },
      { code: 'users.view_any', categoria: 'usuarios', requerido: true },
      { code: 'wallet.view_admin_network', categoria: 'fichas', requerido: true },
      { code: 'deposits.view_admin_network', categoria: 'banco', requerido: true },
      { code: 'withdrawals.view_admin_network', categoria: 'banco', requerido: true },
      { code: 'bonuses.view_any', categoria: 'bonos', requerido: false },
    ],
  },
  {
    id: 'empleado-soporte',
    nombre: 'Empleado de Soporte al Cliente',
    descripcion:
      'Atiende consultas de jugadores. Ve todo lo relevante del cliente para responder (wallet, depósitos, retiros, transferencias bancarias, bonos, promociones, notificaciones enviadas) pero no modifica estado monetario. Combina la vista de Caja + Banco en modo consulta.',
    rol: 'empleado',
    cupoMensualDefault: '0',
    caveat:
      'Las herramientas de live-chat y CRM no están integradas todavía; cuando se sumen, los permisos correspondientes se agregarán automáticamente a esta planilla.',
    permisos: [
      // Ver clientes de la red del admin
      { code: 'users.view_admin_network', categoria: 'usuarios', requerido: true },
      { code: 'users.view_any', categoria: 'usuarios', requerido: true },
      // Ver wallets (mismo alcance que Caja/Fichas — modo lectura)
      { code: 'wallet.view_admin_network', categoria: 'fichas', requerido: true },
      // Ver depósitos + retiros + transferencias + aceptar/rechazar solicitudes
      // de la red del admin. NO incluye withdrawals.process (el "marcar pagado"
      // es plata que sale del banco — queda para banco / caja).
      { code: 'deposits.view_admin_network', categoria: 'banco', requerido: true },
      { code: 'deposits.approve_admin_network', categoria: 'banco', requerido: true },
      { code: 'deposits.reject_admin_network', categoria: 'banco', requerido: true },
      { code: 'withdrawals.view_admin_network', categoria: 'banco', requerido: true },
      { code: 'withdrawals.approve_admin_network', categoria: 'banco', requerido: true },
      { code: 'withdrawals.reject_admin_network', categoria: 'banco', requerido: true },
      // Extracto bancario — subir bank_tx, ver, matchear con deposits
      { code: 'bank_tx.view', categoria: 'banco', requerido: true },
      { code: 'bank_tx.upload', categoria: 'banco', requerido: true },
      { code: 'bank_tx.match', categoria: 'banco', requerido: true },
      // Ver bonos, promos y ligas (para contestar "por qué no me llegó mi bono")
      { code: 'bonuses.view', categoria: 'bonos', requerido: true },
      { code: 'bonuses.view_any', categoria: 'bonos', requerido: true },
      { code: 'promotions.view', categoria: 'bonos', requerido: false },
      // Notifs + audit + juego responsable (contexto de atención)
      // reports.netwin.view / promotions.view_any / leagues.view / leagues.view_any
      // están en el catálogo pero ningún endpoint los enforcea — audit 2026-07.
      { code: 'notifications.view_any', categoria: 'trazabilidad', requerido: true },
      { code: 'audit.view', categoria: 'trazabilidad', requerido: false },
      { code: 'responsible_gaming.review', categoria: 'antifraude', requerido: false },
    ],
  },
] as const;

/**
 * Devuelve la planilla por id o null si no existe. Case-sensitive.
 */
export function getTemplate(id: string): PermissionTemplate | null {
  return PERMISSION_TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * Filtra el set de una planilla dejando solo los codes que el actor
 * PUEDE delegar (grantableSet). Devuelve `{applicable, skipped}` donde
 * skipped son los codes que la planilla incluía pero el actor no puede
 * otorgar (se muestran al pie del modal como aviso).
 */
export function filterByGrantable(
  template: PermissionTemplate,
  grantableSet: Set<string>,
): { applicable: TemplatePermission[]; skipped: TemplatePermission[] } {
  const applicable: TemplatePermission[] = [];
  const skipped: TemplatePermission[] = [];
  for (const p of template.permisos) {
    if (grantableSet.has(p.code)) applicable.push(p);
    else skipped.push(p);
  }
  return { applicable, skipped };
}
