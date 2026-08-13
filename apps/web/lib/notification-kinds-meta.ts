/**
 * Catálogo en criollo de los tipos de notificación (kinds). Da nombre humano,
 * cuándo se envía, categoría, a quién le llega, las variables disponibles (para
 * los chips del editor) y un payload de ejemplo (para la vista previa). Espeja
 * el catálogo del backend `apps/api/src/notifications/notifications.templates.ts`.
 */

export type NotifCategory =
  | 'Depósitos'
  | 'Retiros'
  | 'Bonos'
  | 'Seguridad'
  | 'Operación';

export interface NotifVariable {
  /** Se inserta como {{key}} en la plantilla. */
  key: string;
  /** Nombre en criollo para el chip. */
  label: string;
}

export interface NotifKindMeta {
  code: string;
  label: string;
  whenSent: string;
  category: NotifCategory;
  /** A quién le llega: al jugador o al admin/operador. */
  audience: 'jugador' | 'admin';
  variables: NotifVariable[];
  samplePayload: Record<string, unknown>;
}

export const CATEGORY_ORDER: NotifCategory[] = [
  'Depósitos',
  'Retiros',
  'Bonos',
  'Seguridad',
  'Operación',
];

const V = {
  amountChips: { key: 'amountChips', label: 'Monto en fichas' },
  reason: { key: 'reason', label: 'Motivo' },
  userUsername: { key: 'userUsername', label: 'Usuario' },
  externalRef: { key: 'externalRef', label: 'Referencia bancaria' },
} as const;

export const NOTIFICATION_KINDS: NotifKindMeta[] = [
  // ── Depósitos ──
  {
    code: 'deposit_approved',
    label: 'Depósito aprobado',
    whenSent: 'Cuando aprobás el depósito de un jugador.',
    category: 'Depósitos',
    audience: 'jugador',
    variables: [V.amountChips],
    samplePayload: { amountChips: '5000', depositId: 'dep_ejemplo' },
  },
  {
    code: 'deposit_rejected',
    label: 'Depósito rechazado',
    whenSent: 'Cuando rechazás el depósito de un jugador.',
    category: 'Depósitos',
    audience: 'jugador',
    variables: [V.amountChips, V.reason],
    samplePayload: {
      amountChips: '5000',
      reason: 'El comprobante no coincide',
      depositId: 'dep_ejemplo',
    },
  },
  {
    code: 'new_deposit_for_review',
    label: 'Nuevo depósito para revisar',
    whenSent: 'Cuando un jugador pide un depósito (te avisa a vos).',
    category: 'Depósitos',
    audience: 'admin',
    variables: [V.amountChips, V.userUsername],
    samplePayload: { amountChips: '5000', userUsername: 'juanpe' },
  },
  // ── Retiros ──
  {
    code: 'withdrawal_paid',
    label: 'Retiro procesado',
    whenSent: 'Cuando marcás un retiro como pagado.',
    category: 'Retiros',
    audience: 'jugador',
    variables: [V.amountChips, V.externalRef],
    samplePayload: { amountChips: '3000', externalRef: 'OP-12345' },
  },
  {
    code: 'withdrawal_rejected',
    label: 'Retiro rechazado',
    whenSent: 'Cuando rechazás el retiro de un jugador.',
    category: 'Retiros',
    audience: 'jugador',
    variables: [V.amountChips, V.reason],
    samplePayload: { amountChips: '3000', reason: 'Datos bancarios incompletos' },
  },
  {
    code: 'withdrawal_failed',
    label: 'Retiro con problema',
    whenSent: 'Cuando un retiro no se pudo procesar (ej. error del banco).',
    category: 'Retiros',
    audience: 'jugador',
    variables: [V.amountChips, V.reason],
    samplePayload: { amountChips: '3000', reason: 'Error del banco' },
  },
  {
    code: 'new_withdrawal_for_review',
    label: 'Nuevo retiro para revisar',
    whenSent: 'Cuando un jugador pide un retiro (te avisa a vos).',
    category: 'Retiros',
    audience: 'admin',
    variables: [V.amountChips, V.userUsername],
    samplePayload: { amountChips: '3000', userUsername: 'juanpe' },
  },
  // ── Bonos ──
  {
    code: 'bonus_granted',
    label: 'Recibiste un bono',
    whenSent: 'Cuando le das un bono a un jugador.',
    category: 'Bonos',
    audience: 'jugador',
    variables: [
      { key: 'definitionName', label: 'Nombre del bono' },
      { key: 'amount', label: 'Monto' },
    ],
    samplePayload: { definitionName: 'Bono de bienvenida', amount: '1000' },
  },
  {
    code: 'bonus_expired',
    label: 'Bono expirado',
    whenSent: 'Cuando un bono llega a su fecha de vencimiento.',
    category: 'Bonos',
    audience: 'jugador',
    variables: [{ key: 'remainingAmount', label: 'Monto restante' }],
    samplePayload: { remainingAmount: '500' },
  },
  {
    code: 'bonus_cancelled',
    label: 'Bono cancelado',
    whenSent: 'Cuando cancelás un bono de un jugador.',
    category: 'Bonos',
    audience: 'jugador',
    variables: [V.reason],
    samplePayload: { reason: 'Cancelado por el operador' },
  },
  {
    code: 'welcome_bonus_blocked',
    label: 'Bono de bienvenida en revisión',
    whenSent: 'Cuando el antifraude frena el bono de bienvenida de un jugador.',
    category: 'Bonos',
    audience: 'jugador',
    variables: [],
    samplePayload: { depositId: 'dep_ejemplo' },
  },
  // ── Seguridad ──
  {
    code: 'fraud_link_suspected',
    label: 'Cuentas duplicadas detectadas',
    whenSent: 'Cuando el sistema detecta posibles cuentas duplicadas (te avisa a vos).',
    category: 'Seguridad',
    audience: 'admin',
    variables: [
      { key: 'userAUsername', label: 'Cuenta A' },
      { key: 'userBUsername', label: 'Cuenta B' },
      { key: 'score', label: 'Nivel de sospecha' },
    ],
    samplePayload: { userAUsername: 'juanpe', userBUsername: 'juan_pe2', score: '85' },
  },
  {
    code: 'fraud_cluster_confirmed',
    label: 'Cuentas duplicadas confirmadas',
    whenSent: 'Cuando un admin confirma cuentas duplicadas (aviso al resto de admins).',
    category: 'Seguridad',
    audience: 'admin',
    variables: [
      { key: 'userAUsername', label: 'Cuenta A' },
      { key: 'userBUsername', label: 'Cuenta B' },
      { key: 'confirmedByUsername', label: 'Confirmado por' },
    ],
    samplePayload: {
      userAUsername: 'juanpe',
      userBUsername: 'juan_pe2',
      confirmedByUsername: 'admin',
    },
  },
  {
    code: 'movement_alert_suspected',
    label: 'Movimientos sospechosos',
    whenSent: 'Cuando el sistema detecta movimientos sospechosos (te avisa a vos).',
    category: 'Seguridad',
    audience: 'admin',
    variables: [{ key: 'count', label: 'Cantidad de alertas' }],
    samplePayload: { count: '3' },
  },
  {
    code: 'password_reset_by_admin',
    label: 'Contraseña reseteada',
    whenSent: 'Cuando reseteás la contraseña de un usuario.',
    category: 'Seguridad',
    audience: 'jugador',
    variables: [{ key: 'actorUsername', label: 'Quién la reseteó' }],
    samplePayload: { actorUsername: 'admin', actorRole: 'admin_tenant' },
  },
  // ── Operación ──
  {
    code: 'game_provider_alert',
    label: 'Alerta de proveedor de juegos',
    whenSent: 'Cuando hay un problema con un proveedor de juegos (te avisa a vos).',
    category: 'Operación',
    audience: 'admin',
    variables: [
      { key: 'title', label: 'Título' },
      { key: 'message', label: 'Mensaje' },
    ],
    samplePayload: { title: 'Proveedor caído', message: 'Palace no responde' },
  },
];

const BY_CODE = new Map(NOTIFICATION_KINDS.map((k) => [k.code, k]));

/** Meta de un kind, con fallback prolijo si no está en el catálogo. */
export function getKindMeta(code: string): NotifKindMeta {
  const found = BY_CODE.get(code);
  if (found) return found;
  return {
    code,
    label: code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    whenSent: 'Aviso automático del sistema.',
    category: 'Operación',
    audience: 'admin',
    variables: [],
    samplePayload: {},
  };
}
