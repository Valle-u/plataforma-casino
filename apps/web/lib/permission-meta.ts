/**
 * Metadata "amigable" de permisos para el panel admin.
 *
 * El catálogo del backend (`/tenant/permission-overrides/catalog`) devuelve
 * códigos crudos (`wallet.burn`) + una descripción técnica corta del seed —
 * ilegible para un operador que tiene que decidir si le da un permiso a un
 * empleado. Este mapa traduce CADA código a:
 *   - label:       nombre claro en castellano (sin el código ni jerga).
 *   - what:        qué habilita concretamente.
 *   - consequence: qué puede pasar si lo otorgás (el riesgo real).
 *   - risk:        low | medium | high → para badges y orden visual.
 *
 * Es presentación pura (vive en el front, como `constants.ts` de roles). El
 * backend sigue siendo la fuente de verdad de QUÉ permisos existen y de la
 * autorización real. Si se agrega un permiso nuevo al seed sin entrada acá,
 * `getPermissionMeta` cae a un fallback conservador (riesgo alto + aviso).
 *
 * Copy redactada para operadores NO técnicos. Mantener en sync con el
 * catálogo del seed (`packages/db/src/seeds/tenant-seed.ts`).
 */

export type PermissionRisk = 'low' | 'medium' | 'high';

export interface PermissionMeta {
  /** Nombre amigable, 2-5 palabras, sin el código ni jerga. */
  label: string;
  /** Qué habilita concretamente a quien lo recibe. */
  what: string;
  /** Qué puede pasar si lo otorgás — el riesgo/impacto real. */
  consequence: string;
  /** Nivel de riesgo para el badge y el orden visual. */
  risk: PermissionRisk;
}

export const RISK_LABELS: Record<PermissionRisk, string> = {
  low: 'Riesgo bajo',
  medium: 'Riesgo medio',
  high: 'Riesgo alto',
};

/** Orden de severidad (mayor primero) — útil para ordenar listas por riesgo. */
export const RISK_ORDER: Record<PermissionRisk, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Nombres amigables de cada categoría del catálogo. */
export const CATEGORY_LABELS: Record<string, string> = {
  wallet: 'Billetera y fichas',
  wallet_stats: 'Estadísticas de pago',
  game_stats: 'Estadísticas de juego',
  bank_tx: 'Transferencias bancarias',
  commissions: 'Comisiones',
  users: 'Usuarios',
  deposits: 'Depósitos',
  withdrawals: 'Retiros',
  roles: 'Roles',
  permissions: 'Permisos',
  reports: 'Reportes',
  audit: 'Auditoría',
  tenant: 'Configuración del casino',
  responsible_gaming: 'Juego responsable',
  notifications: 'Notificaciones',
  bonuses: 'Bonos',
  promotions: 'Promociones y sorteos',
  leagues: 'Ligas',
  fraud: 'Antifraude',
  games: 'Juegos',
  branch: 'Sucursales',
  ledger: 'Integridad del ledger',
  house: 'Tesorería / Casa',
  otros: 'Otros',
};

export const PERMISSION_META: Record<string, PermissionMeta> = {
  // ── Integridad del ledger ───────────────────────────────────────────
  'ledger.view': {
    label: 'Ver integridad del ledger',
    what: 'Ver el chequeo de que las fichas cuadran (reconciliación), el supply de fichas y el historial de chequeos.',
    consequence:
      'Solo lectura. Muestra números sensibles del negocio (supply, descuadres), pero no puede cambiar nada.',
    risk: 'low',
  },
  'ledger.reconcile': {
    label: 'Correr chequeo del ledger',
    what: 'Disparar el chequeo de integridad cuando quiera (además del automático nocturno).',
    consequence:
      'El chequeo es read-only sobre la economía: no mueve fichas, solo deja registro de la corrida.',
    risk: 'low',
  },

  // ── Tesorería / Casa ────────────────────────────────────────────────
  'house.view': {
    label: 'Ver la tesorería',
    what: 'Ver el estado de la Casa (saldo de la caja, capital, exposición).',
    consequence:
      'Solo lectura. Muestra los números de la caja del casino, pero no puede mover nada.',
    risk: 'low',
  },
  'house.inject_capital': {
    label: 'Aportar capital a la Casa',
    what: 'Crear fichas para la Casa registrando la plata real que las respalda.',
    consequence:
      'Es la ÚNICA forma de crear fichas nuevas en el sistema — alto impacto económico. Queda atado a un respaldo real y auditado.',
    risk: 'high',
  },

  // ── Billetera y fichas ──────────────────────────────────────────────
  'wallet.load': {
    label: 'Cargar fichas a usuarios',
    what: 'Permite sumar fichas a la cuenta de un usuario.',
    consequence: 'Si se equivoca o abusa, puede regalar fichas de más a cualquier cuenta y hacerte perder plata. Queda registrado quién lo hizo.',
    risk: 'medium',
  },
  'wallet.unload': {
    label: 'Descargar fichas de usuarios',
    what: 'Permite restar fichas de la cuenta de un usuario.',
    consequence: 'Si se equivoca o abusa, puede vaciar el saldo de cualquier jugador o empleado y generar reclamos. Queda registrado quién lo hizo.',
    risk: 'medium',
  },
  'wallet.adjust': {
    label: 'Ajustar saldo a mano',
    what: 'Permite cambiar el saldo de una cuenta manualmente indicando un motivo.',
    consequence: 'Puede subir o bajar el saldo de cualquier cuenta a su antojo, con la excusa que quiera. Queda registrado, pero el dinero ya se movió.',
    risk: 'high',
  },
  'wallet.correct': {
    label: 'Cargas por corrección / bonificación',
    what: 'Permite cargar fichas a un cliente por corrección de un error, bonificación o reintegro. Las fichas salen de la Casa (no de su propia billetera), hasta el tope del cupo mensual que le fijaste. Cada carga exige elegir un motivo del listado y queda con detalle en la auditoría.',
    consequence: 'Puede regalar fichas a clientes hasta agotar su cupo del mes. El cupo es el techo del daño: si le ponés $50.000/mes, ese es lo máximo que puede mover. Si aún no le fijaste cupo (o está en 0), aunque tenga este permiso NO puede cargar nada. Configurá el cupo desde la wallet del empleado o desde Tesorería.',
    risk: 'medium',
  },
  'wallet.burn': {
    label: 'Destruir fichas',
    what: 'Permite eliminar fichas del sistema de forma definitiva.',
    consequence: 'Borra dinero real que no se puede recuperar. Una sola pifia destruye saldo que no vuelve. Queda registrado.',
    risk: 'high',
  },
  'wallet.view_any': {
    label: 'Ver saldo de cualquiera',
    what: 'Permite consultar el saldo de cualquier usuario del casino.',
    consequence: 'Solo mira, no toca nada. Pero ve la plata de todos, incluso de cuentas que no son de su red. Expone información sensible de jugadores y socios.',
    risk: 'low',
  },
  'wallet.export': {
    label: 'Exportar movimientos a archivo',
    what: 'Permite bajar a un archivo todos los movimientos de fichas de las cuentas.',
    consequence: 'Solo lee y descarga, no modifica nada. Pero ese archivo sale del sistema con el historial de plata de la gente y puede terminar en cualquier lado. Queda registrado quién lo bajó.',
    risk: 'low',
  },

  // ── Estadísticas de pago ────────────────────────────────────────────
  'wallet_stats.view_any': {
    label: 'Ver pagos de todo el casino',
    what: 'Permite ver las estadísticas de pagos de todo el casino, sin importar a qué red pertenezca.',
    consequence: 'Solo mira, no toca nada. Pero ve los números de pago de absolutamente todo el casino, incluso de redes ajenas a la suya. Datos sensibles del negocio entero.',
    risk: 'low',
  },
  'wallet_stats.view_own_network': {
    label: 'Ver pagos de mi red',
    what: 'Permite ver las estadísticas de pagos de su propia red de cuentas.',
    consequence: 'Solo mira, no toca nada, y solo lo de su red. Igual ve cuánto se paga ahí adentro, así que es información del negocio de tu grupo.',
    risk: 'low',
  },
  'wallet_stats.export': {
    label: 'Exportar pagos a archivo',
    what: 'Permite bajar a un archivo las estadísticas de pagos.',
    consequence: 'Solo lee y descarga, no modifica nada. Pero los números de pago salen en un archivo que puede compartirse o filtrarse. Queda registrado quién lo bajó.',
    risk: 'low',
  },

  // ── Transferencias bancarias ────────────────────────────────────────
  'bank_tx.upload': {
    label: 'Cargar transferencias entrantes',
    what: 'Registra en el sistema las transferencias bancarias que entran para luego cruzarlas con los depósitos.',
    consequence: 'Puede inventar o cargar transferencias falsas que después se usan para justificar depósitos que nunca entraron, abriendo la puerta a acreditar fichas sin plata real.',
    risk: 'high',
  },
  'bank_tx.view': {
    label: 'Ver transferencias bancarias',
    what: 'Muestra el listado de transferencias bancarias entrantes para compararlas con los depósitos.',
    consequence: 'Solo ve las transferencias, no las toca; pero queda expuesta información bancaria sensible (montos, cuentas, movimientos) ante quien reciba el permiso.',
    risk: 'low',
  },
  'bank_tx.match': {
    label: 'Vincular transferencia con depósito',
    what: 'Asocia una transferencia bancaria con un depósito al momento de aprobarlo.',
    consequence: 'Puede emparejar mal una transferencia con un depósito equivocado y dar por cobrado un depósito que en realidad no se pagó; queda registrado, pero puede acreditar fichas indebidas.',
    risk: 'medium',
  },
  'bank_tx.edit': {
    label: 'Editar transferencias',
    what: 'Permite corregir los datos de una transferencia bancaria que todavía no se matcheó (monto, cuenta, remitente, fecha).',
    consequence: 'Puede cambiar el monto o los datos de una transferencia antes de vincularla; un dato mal puesto lleva a matchearla mal después. Solo aplica a transferencias sin matchear y queda registrado.',
    risk: 'medium',
  },
  'bank_tx.delete': {
    label: 'Borrar transferencias bancarias',
    what: 'Elimina del sistema una transferencia bancaria registrada.',
    consequence: 'Puede hacer desaparecer una transferencia real y romper la conciliación de la caja, borrando el rastro de plata que sí entró; es irreversible.',
    risk: 'high',
  },

  // ── Comisiones ──────────────────────────────────────────────────────
  'commissions.settle': {
    label: 'Pagar comisiones pendientes',
    what: 'Liquida las comisiones que se deben y acredita esas fichas a quienes corresponde.',
    consequence: 'Crea fichas nuevas y las reparte como comisión; si se equivoca o abusa, genera plata de la nada y la deposita en cuentas, sin vuelta atrás.',
    risk: 'high',
  },
  'commissions.configure': {
    label: 'Configurar reglas de comisión',
    what: 'Define los porcentajes de comisión que se pagan por cada rol y cada evento.',
    consequence: 'Puede subir los porcentajes a su favor o de un cómplice y hacer que todas las liquidaciones futuras paguen de más, afectando las ganancias del casino.',
    risk: 'high',
  },
  'commissions.view': {
    label: 'Ver comisiones de mi red',
    what: 'Muestra los pagos de comisión correspondientes a su propia red.',
    consequence: 'Solo consulta, no modifica nada; pero ve cuánto cobran de comisión las personas de su red.',
    risk: 'low',
  },
  'commissions.view_all': {
    label: 'Ver todas las comisiones',
    what: 'Muestra los pagos de comisión de todo el casino, no solo de su red.',
    consequence: 'Solo consulta, no modifica nada; pero deja ver lo que cobran absolutamente todos, incluida información comercial de otras redes.',
    risk: 'low',
  },

  // ── Depósitos ───────────────────────────────────────────────────────
  'deposits.view': {
    label: 'Ver depósitos de mi red',
    what: 'Muestra los depósitos cargados por los jugadores de su propia red.',
    consequence: 'Solo consulta, no modifica nada; pero accede a datos de los movimientos de carga de su red.',
    risk: 'low',
  },
  'deposits.view_all': {
    label: 'Ver todos los depósitos',
    what: 'Muestra los depósitos de todo el casino, no solo los de su red.',
    consequence: 'Solo consulta, no modifica nada; pero expone todos los depósitos del casino, incluidos los de otras redes.',
    risk: 'low',
  },
  'deposits.approve': {
    label: 'Aprobar depósitos',
    what: 'Aprueba un depósito y acredita las fichas correspondientes al jugador.',
    consequence: 'Puede dar por buenos depósitos que nunca entraron y cargar fichas sin respaldo de plata real, regalando saldo a una cuenta.',
    risk: 'medium',
  },
  'deposits.reject': {
    label: 'Rechazar depósitos',
    what: 'Rechaza un depósito indicando un motivo.',
    consequence: 'Puede rechazar depósitos legítimos y dejar a jugadores sin acreditar su carga; queda registrado y se puede revisar.',
    risk: 'medium',
  },
  'deposits.export': {
    label: 'Exportar depósitos a archivo',
    what: 'Descarga el listado de depósitos en un archivo.',
    consequence: 'Solo extrae datos, no cambia nada; pero se lleva afuera información de movimientos de jugadores que podría filtrarse o compartirse.',
    risk: 'low',
  },

  // ── Retiros ─────────────────────────────────────────────────────────
  'withdrawals.view': {
    label: 'Ver retiros de mi red',
    what: 'Muestra los retiros solicitados por los jugadores de su propia red.',
    consequence: 'Solo consulta, no modifica nada; pero accede a los datos de los retiros de su red.',
    risk: 'low',
  },
  'withdrawals.view_all': {
    label: 'Ver todos los retiros',
    what: 'Muestra los retiros de todo el casino, no solo los de su red.',
    consequence: 'Solo consulta, no modifica nada; pero expone todos los retiros del casino, incluidos los de otras redes.',
    risk: 'low',
  },
  'withdrawals.approve': {
    label: 'Aprobar retiros',
    what: 'Aprueba un retiro solicitado por un jugador.',
    consequence: 'Puede dar luz verde a retiros indebidos o fraudulentos y habilitar que salga plata que no correspondía pagar.',
    risk: 'medium',
  },
  'withdrawals.reject': {
    label: 'Rechazar retiros',
    what: 'Rechaza un retiro solicitado por un jugador.',
    consequence: 'Puede frenar retiros legítimos y retener la plata de los jugadores; queda registrado y se puede revisar.',
    risk: 'medium',
  },
  'withdrawals.process': {
    label: 'Marcar retiro como pagado',
    what: 'Marca un retiro como ya pagado al jugador.',
    consequence: 'Puede marcar como pagados retiros que no se abonaron (o tapar pagos hechos por afuera), descuadrando la caja y el control de la plata que sale.',
    risk: 'medium',
  },
  'withdrawals.export': {
    label: 'Exportar retiros a archivo',
    what: 'Descarga el listado de retiros en un archivo.',
    consequence: 'Solo extrae datos, no cambia nada; pero se lleva afuera información de retiros de jugadores que podría filtrarse o compartirse.',
    risk: 'low',
  },

  // ── Usuarios ────────────────────────────────────────────────────────
  'users.create': {
    label: 'Crear usuarios',
    what: 'Permite dar de alta nuevas cuentas de usuario dentro de su red.',
    consequence: 'Si abusa, puede llenar el sistema de cuentas falsas o crear accesos para gente que no debería operar.',
    risk: 'medium',
  },
  'users.edit': {
    label: 'Editar usuarios',
    what: 'Permite modificar los datos de las cuentas de usuario de su red.',
    consequence: 'Si se equivoca o abusa, puede cambiar datos de cuentas ajenas y dejar a alguien sin poder operar.',
    risk: 'medium',
  },
  'users.reset_password': {
    label: 'Resetear contraseñas',
    what: 'Permite cambiar la contraseña de cualquier usuario de su red.',
    consequence: 'Puede tomar control de la cuenta de otra persona y operar en su nombre dejándola afuera.',
    risk: 'high',
  },
  'users.ban': {
    label: 'Banear o suspender usuarios',
    what: 'Permite bloquear o suspender cuentas para que no puedan operar.',
    consequence: 'Puede dejar afuera a empleados o jugadores legítimos y frenar la operación de toda una sucursal.',
    risk: 'high',
  },
  'users.view_any': {
    label: 'Ver usuarios de mi red',
    what: 'Permite ver el listado de los usuarios que dependen de su red.',
    consequence: 'Solo mira, no modifica nada, pero queda expuesta la lista de cuentas y datos de su red.',
    risk: 'low',
  },
  'users.view_all': {
    label: 'Ver todo el tenant (incluye independientes)',
    what: 'Permite ver el listado COMPLETO del casino, incluida la sub-red de socios independientes (que son "casinos separados" dentro del tenant). Solo el admin lo tiene por default; no se puede delegar. Para que un empleado vea la red del admin sin invadir la del independiente, usá "Ver la red del admin".',
    consequence: 'Rompe el aislamiento del modelo: expone jugadores, cajeros y datos de los socios independientes al que lo tenga. Reservado al admin.',
    risk: 'high',
  },
  'users.view_admin_network': {
    label: 'Ver la red del admin',
    what: 'Permite ver el listado de usuarios de la red del admin: la Casa, socios dependientes, distribuidores, cajeros y jugadores que colgan de esa red. NO expone la sub-red de socios independientes (aislamiento del modelo). Ideal para empleados de confianza que atienden clientes de la red del admin. Requiere también "Ver usuarios de mi red" (users.view_any) — otorgá los dos juntos.',
    consequence: 'Solo mira, no modifica. La persona ve todo el ecosistema operativo del admin (jugadores, saldos, movimientos), pero no puede espiar la sub-red de un socio independiente.',
    risk: 'low',
  },
  'users.impersonate': {
    label: 'Operar como otro usuario',
    what: 'Permite entrar al sistema y operar haciéndose pasar por otra persona.',
    consequence: 'Puede hacer cualquier cosa que haga esa persona, mover fichas y tomar decisiones a su nombre sin que se note.',
    risk: 'high',
  },
  'users.change_hierarchy': {
    label: 'Cambiar de quién depende un usuario',
    what: 'Permite reubicar a un usuario para que cuelgue de otro responsable en la estructura.',
    consequence: 'Puede desviar comisiones y control de cuentas hacia otra persona y romper la cadena de mando.',
    risk: 'high',
  },
  'users.export': {
    label: 'Exportar lista de usuarios',
    what: 'Permite bajar la lista de usuarios a un archivo para guardarlo o abrirlo afuera.',
    consequence: 'Solo lee y descarga, no modifica nada, pero se lleva datos de las cuentas fuera del sistema.',
    risk: 'low',
  },

  // ── Roles ───────────────────────────────────────────────────────────
  'roles.create': {
    label: 'Crear roles',
    what: 'Permite armar nuevos roles con su propio conjunto de permisos.',
    consequence: 'Puede inventar un rol con poderes peligrosos y asignárselo a quien quiera.',
    risk: 'high',
  },
  'roles.edit': {
    label: 'Editar roles',
    what: 'Permite cambiar qué puede hacer cada rol ya existente.',
    consequence: 'Puede agregar poderes peligrosos a un rol y todos los que lo tengan quedan habilitados de golpe.',
    risk: 'high',
  },

  // ── Permisos ────────────────────────────────────────────────────────
  'permissions.grant': {
    label: 'Otorgar permisos',
    what: 'Permite dar permisos sueltos a un usuario sin pasar por un rol.',
    consequence: 'Puede darse a sí mismo o a un cómplice poderes que no le corresponden, incluso para mover dinero.',
    risk: 'high',
  },
  'permissions.revoke': {
    label: 'Quitar permisos',
    what: 'Permite sacarle permisos sueltos a un usuario.',
    consequence: 'Puede dejar sin poder operar a otra persona quitándole accesos que necesitaba para trabajar.',
    risk: 'high',
  },

  // ── Bonos ───────────────────────────────────────────────────────────
  'bonuses.view': {
    label: 'Ver mis bonos',
    what: 'Ver las plantillas de bonos y los bonos entregados que le pertenecen a esta persona.',
    consequence: 'Solo mira sus propios bonos, no modifica nada ni mueve fondos.',
    risk: 'low',
  },
  'bonuses.view_any': {
    label: 'Ver bonos de mi red',
    what: 'Ver los bonos de toda la red de personas que dependen de quien lo recibe.',
    consequence: 'Solo mira bonos de su red, sin tocar nada. Expone con qué bonos juegan sus jugadores y agentes.',
    risk: 'low',
  },
  'bonuses.view_all': {
    label: 'Ver todos los bonos del casino',
    what: 'Ver absolutamente todos los bonos de todo el casino, sin importar de quién sean.',
    consequence: 'Solo mira, pero ve los bonos de todos los jugadores y agentes del casino entero. Da una visión total del negocio.',
    risk: 'low',
  },
  'bonuses.create_definition': {
    label: 'Crear plantillas de bono',
    what: 'Crear nuevas plantillas de bono que después se entregan a los jugadores.',
    consequence: 'Puede armar bonos con montos o condiciones demasiado generosas y regalar fichas en serie. Queda registrado quién lo creó.',
    risk: 'high',
  },
  'bonuses.edit_definition': {
    label: 'Editar plantillas de bono',
    what: 'Modificar las condiciones, montos o reglas de plantillas de bono ya existentes.',
    consequence: 'Puede cambiar un bono para que entregue más fichas de las previstas o aflojar las condiciones. Queda registrado quién lo editó.',
    risk: 'high',
  },
  'bonuses.grant_manual': {
    label: 'Dar bonos a mano',
    what: 'Otorgar un bono directamente a un jugador a su criterio.',
    consequence: 'Puede regalar bonos a quien quiera y cargarle saldo de promoción a la cuenta. Es acotado por bono pero queda registrado quién lo dio.',
    risk: 'medium',
  },
  'bonuses.cancel': {
    label: 'Cancelar bonos activos',
    what: 'Cancelar un bono que está activo y devolver los fondos a su origen.',
    consequence: 'Puede quitarle a un jugador un bono que tenía en curso. Es reversible porque devuelve los fondos y queda registrado quién canceló.',
    risk: 'medium',
  },
  'bonuses.force_clear': {
    label: 'Forzar cobro de bono',
    what: 'Pasar a la fuerza el saldo de un bono al dinero real del jugador, salteando las condiciones.',
    consequence: 'Puede convertir saldo de bono en plata retirable sin que el jugador cumpla los requisitos. Eso es plata real que se va. Queda registrado quién lo forzó.',
    risk: 'high',
  },
  'bonuses.export': {
    label: 'Exportar bonos a archivo',
    what: 'Descargar a un archivo el listado de bonos entregados.',
    consequence: 'Solo baja datos, no modifica nada. El archivo sale del sistema y puede contener información de jugadores. Queda registrado quién exportó.',
    risk: 'low',
  },
  'bonuses.export_definitions': {
    label: 'Exportar plantillas de bono',
    what: 'Descargar a un archivo el listado de plantillas de bono.',
    consequence: 'Solo baja datos, no modifica nada. El archivo muestra cómo están armados sus bonos y promociones. Queda registrado quién exportó.',
    risk: 'low',
  },

  // ── Promociones y sorteos ───────────────────────────────────────────
  'promotions.view': {
    label: 'Ver promociones y sorteos',
    what: 'Ver las promociones y sorteos activos y las participaciones propias.',
    consequence: 'Solo mira sus promociones y participaciones, no modifica nada ni entrega premios.',
    risk: 'low',
  },
  'promotions.view_any': {
    label: 'Ver promociones de cualquiera',
    what: 'Ver las promociones, sorteos y entregas de premios de cualquier jugador.',
    consequence: 'Solo mira, pero ve quién participó y qué premios recibió cualquier jugador. No cambia nada.',
    risk: 'low',
  },
  'promotions.create_definition': {
    label: 'Crear promociones y sorteos',
    what: 'Crear nuevas promociones o sorteos con sus premios y reglas.',
    consequence: 'Puede armar sorteos o promos que reparten premios en fichas con condiciones demasiado generosas. Queda registrado quién lo creó.',
    risk: 'high',
  },
  'promotions.edit_definition': {
    label: 'Editar promociones y sorteos',
    what: 'Modificar las reglas, premios o fechas de promociones o sorteos existentes.',
    consequence: 'Puede cambiar premios o condiciones de una promo en curso y repartir de más. Queda registrado quién lo editó.',
    risk: 'high',
  },
  'promotions.cancel': {
    label: 'Cancelar promociones y sorteos',
    what: 'Cancelar una promoción o sorteo y devolver los fondos que todavía no se entregaron.',
    consequence: 'Puede dar de baja una promo o sorteo en marcha y frenar las entregas pendientes. Devuelve los fondos no repartidos y queda registrado quién canceló.',
    risk: 'high',
  },
  'promotions.export': {
    label: 'Exportar promociones a archivo',
    what: 'Descargar a un archivo el listado de promociones y sorteos.',
    consequence: 'Solo baja datos, no modifica nada. El archivo sale del sistema con datos de participantes y premios. Queda registrado quién exportó.',
    risk: 'low',
  },

  // ── Ligas ───────────────────────────────────────────────────────────
  'leagues.view': {
    label: 'Ver ligas y posiciones',
    what: 'Ver las ligas activas y la tabla de posiciones.',
    consequence: 'Solo mira ligas y posiciones, no modifica nada ni entrega premios.',
    risk: 'low',
  },
  'leagues.view_any': {
    label: 'Ver ligas con resultados',
    what: 'Ver las ligas con sus resultados completos, no solo las posiciones generales.',
    consequence: 'Solo mira, pero accede al detalle completo de resultados de las ligas. No cambia nada.',
    risk: 'low',
  },
  'leagues.create_definition': {
    label: 'Crear ligas',
    what: 'Crear nuevas ligas con sus premios y reglas de competencia.',
    consequence: 'Puede armar ligas con premios en fichas demasiado altos o reglas flojas. Queda registrado quién la creó.',
    risk: 'high',
  },
  'leagues.edit_definition': {
    label: 'Editar ligas',
    what: 'Modificar las reglas, premios o fechas de ligas existentes.',
    consequence: 'Puede cambiar premios o condiciones de una liga en curso y repartir de más. Queda registrado quién la editó.',
    risk: 'high',
  },
  'leagues.run_actions': {
    label: 'Cerrar liga y dar premios',
    what: 'Forzar el recálculo o el cierre de una liga, lo que entrega los premios a los ganadores.',
    consequence: 'Puede cerrar una liga antes de tiempo y repartir los premios en fichas a quienes figuren primeros. Esas fichas se entregan y queda registrado quién lo hizo.',
    risk: 'high',
  },
  'leagues.export': {
    label: 'Exportar ligas a archivo',
    what: 'Descargar a un archivo el listado de ligas y sus resultados.',
    consequence: 'Solo baja datos, no modifica nada. El archivo sale del sistema con datos de participantes y premios. Queda registrado quién exportó.',
    risk: 'low',
  },

  // ── Estadísticas de juego ───────────────────────────────────────────
  'game_stats.view_any': {
    label: 'Ver estadísticas de todo el casino',
    what: 'Muestra las estadísticas de juego de todas las salas y jugadores del casino.',
    consequence: 'Solo permite ver, no modifica nada, pero expone el detalle de la actividad de juego de todo el casino, incluso de redes que no le pertenecen.',
    risk: 'low',
  },
  'game_stats.view_own_network': {
    label: 'Ver estadísticas de mi red',
    what: 'Muestra las estadísticas de juego de los jugadores y agentes de su propia red.',
    consequence: 'Solo permite ver, no modifica nada, pero deja a la vista cuánto juega y cómo se mueve toda su red.',
    risk: 'low',
  },
  'game_stats.export': {
    label: 'Exportar estadísticas de juego',
    what: 'Descarga las estadísticas de juego en un archivo para abrir fuera del panel.',
    consequence: 'Saca los datos de juego del sistema a un archivo que después puede compartirse o filtrarse sin control; queda registrado quién lo hizo.',
    risk: 'low',
  },

  // ── Reportes ────────────────────────────────────────────────────────
  'reports.netwin.view': {
    label: 'Ver ganancia neta del casino',
    what: 'Muestra los reportes de ganancia neta del casino, lo que realmente gana después de pagar premios.',
    consequence: 'Solo permite ver, no modifica nada, pero expone una cifra sensible: cuánta plata gana el negocio.',
    risk: 'low',
  },
  'reports.export': {
    label: 'Exportar reportes',
    what: 'Descarga los reportes del casino en un archivo para abrir fuera del panel.',
    consequence: 'Saca reportes con cifras sensibles del negocio a un archivo que después puede compartirse o filtrarse; queda registrado quién lo hizo.',
    risk: 'low',
  },

  // ── Auditoría ───────────────────────────────────────────────────────
  'audit.view': {
    label: 'Ver registro de auditoría',
    what: 'Muestra el historial de quién hizo cada acción importante dentro del panel.',
    consequence: 'Solo permite ver, no modifica nada, pero deja a la vista todos los movimientos y acciones de los demás usuarios.',
    risk: 'low',
  },
  'audit.export': {
    label: 'Exportar registro de auditoría',
    what: 'Descarga el historial de auditoría completo en un archivo para abrir fuera del panel.',
    consequence: 'Saca afuera el registro de todo lo que pasó en el panel, un dato muy delicado que puede usarse para ocultar rastros o filtrarse; queda registrado quién lo hizo.',
    risk: 'low',
  },

  // ── Configuración del casino ────────────────────────────────────────
  'payment_methods.edit': {
    label: 'Editar métodos de pago',
    what: 'Crea, modifica o desactiva los medios por los que entra y sale plata del casino.',
    consequence: 'Si se equivoca o abusa, puede desviar pagos, dejar a los jugadores sin poder cargar o retirar, o redirigir cobros a una cuenta ajena; queda registrado quién lo hizo.',
    risk: 'high',
  },
  'tenant.settings.edit': {
    label: 'Editar configuración del casino',
    what: 'Cambia la configuración general que regula cómo funciona todo el casino.',
    consequence: 'Un cambio mal hecho puede romper el funcionamiento del casino o aflojar controles importantes para todos los usuarios; queda registrado quién lo hizo.',
    risk: 'high',
  },
  'branding.edit': {
    label: 'Editar imagen del casino',
    what: 'Cambia el logo, los colores y el nombre con que se muestra el casino.',
    consequence: 'Puede dejar el casino con una imagen equivocada o desprolija frente a todos los jugadores; queda registrado quién lo hizo.',
    risk: 'high',
  },
  'tenant.notifications.templates.edit': {
    label: 'Editar textos automáticos',
    what: 'Modifica los mensajes automáticos que el casino les envía a los usuarios.',
    consequence: 'Puede mandar a todos los jugadores mensajes con información equivocada, confusa o inapropiada en nombre del casino; queda registrado quién lo hizo.',
    risk: 'high',
  },

  // ── Notificaciones ──────────────────────────────────────────────────
  'notifications.view_any': {
    label: 'Ver notificaciones de cualquiera',
    what: 'Muestra las notificaciones enviadas a cualquier usuario del casino.',
    consequence: 'Solo permite ver, no modifica nada, pero expone mensajes privados que recibieron otros usuarios.',
    risk: 'low',
  },
  'notifications.export': {
    label: 'Exportar notificaciones',
    what: 'Descarga las notificaciones en un archivo para abrir fuera del panel.',
    consequence: 'Saca afuera mensajes que recibieron los usuarios a un archivo que después puede compartirse o filtrarse; queda registrado quién lo hizo.',
    risk: 'low',
  },
  'notifications.retry': {
    label: 'Reenviar notificaciones fallidas',
    what: 'Vuelve a intentar el envío de las notificaciones que no llegaron.',
    consequence: 'Como mucho hace que a algún usuario le llegue de nuevo un mensaje atrasado o repetido; es acotado y reversible, y queda registrado quién lo hizo.',
    risk: 'low',
  },

  // ── Juego responsable ───────────────────────────────────────────────
  'responsible_gaming.self_set': {
    label: 'Configurar mis propios límites',
    what: 'Permite a la persona ponerse a sí misma límites de juego o autoexcluirse.',
    consequence: 'Solo se afecta a sí misma: se pone límites de juego o se autoexcluye. No toca la cuenta de nadie más ni mueve fondos. Queda registrado quién lo hizo.',
    risk: 'low',
  },
  'responsible_gaming.admin_set': {
    label: 'Forzar límites a otro usuario',
    what: 'Impone límites de juego o autoexclusión sobre la cuenta de otra persona.',
    consequence: 'Puede bloquear o frenar el juego de cualquier jugador sin su consentimiento, o sacarle una protección que tenía puesta; queda registrado quién lo hizo.',
    risk: 'high',
  },
  'responsible_gaming.review': {
    label: 'Ver límites de otros usuarios',
    what: 'Muestra los límites de juego y las autoexclusiones que tienen otros usuarios.',
    consequence: 'Solo permite ver, no modifica nada, pero expone un dato sensible sobre la situación de juego de cada persona.',
    risk: 'low',
  },

  // ── Juegos ──────────────────────────────────────────────────────────
  'games.edit': {
    label: 'Gestionar juegos disponibles',
    what: 'Decide qué juegos quedan habilitados o deshabilitados en el casino.',
    consequence: 'Puede dejar sin juegos a todos los jugadores o habilitar juegos que no correspondían; afecta a todo el casino y queda registrado quién lo hizo.',
    risk: 'high',
  },

  // ── Antifraude ──────────────────────────────────────────────────────
  'fraud.view': {
    label: 'Ver señales de antifraude',
    what: 'Muestra las señales de antifraude y los grupos de cuentas marcadas como sospechosas.',
    consequence: 'Solo permite ver, no modifica nada, pero expone qué jugadores o cuentas están marcados como sospechosos.',
    risk: 'low',
  },
  'fraud.review': {
    label: 'Revisar señales de antifraude',
    what: 'Permite confirmar o descartar pares de cuentas marcadas como sospechosas.',
    consequence: 'Puede dar por buenas cuentas que en realidad son fraudulentas, o descartar alertas reales, debilitando el control antifraude. Queda registrado quién lo hizo.',
    risk: 'medium',
  },
  'fraud.run_scan': {
    label: 'Ejecutar escaneo de antifraude',
    what: 'Dispara manualmente el análisis de detección de fraude.',
    consequence: 'Como mucho recalcula las señales; no mueve dinero, cuentas ni permisos. Queda registrado quién lo hizo.',
    risk: 'low',
  },

  // ── Sucursales ──────────────────────────────────────────────────────
  'branch.toggle_independence': {
    label: 'Activar sucursal independiente',
    what: 'Activa o desactiva el modo de sucursal independiente para un socio.',
    consequence: 'Cambia cómo opera y se le cobra a un socio; activarlo o sacarlo por error altera la relación comercial y el manejo de fichas de esa sucursal. Queda registrado quién lo hizo.',
    risk: 'high',
  },
  'branch.sell_chips': {
    label: 'Vender fichas a un socio',
    what: 'Le vende fichas a una sucursal independiente al precio configurado.',
    consequence: 'Mueve plata real entre el casino y el socio; una venta mal hecha o de más entrega fichas que valen dinero y es difícil de revertir. Queda registrado quién lo hizo.',
    risk: 'high',
  },
  'branch.view': {
    label: 'Ver sucursales independientes',
    what: 'Muestra el listado de sucursales independientes y sus reportes.',
    consequence: 'Solo permite ver, no modifica nada, pero expone los datos y números de cada sucursal independiente.',
    risk: 'low',
  },

  // ── Comodín externo — red del admin ─────────────────────────────────
  // Permisos "*_admin_network": pensados para un empleado (u operador
  // de confianza) que NO está en la jerarquía del tenant y sin embargo
  // debe operar sobre toda la red del admin. NUNCA alcanzan a la
  // sub-red del socio independiente (aislamiento del modelo).
  // Otorgar por override — no vienen con ningún rol por default.
  'wallet.load_admin_network': {
    label: 'Cargar fichas — red del admin',
    what: 'Le permite cargar fichas a cualquier user de la red del admin (Casa, socios dependientes, cajeros, jugadores). No puede tocar la sub-red de un socio independiente.',
    consequence: 'Mueve fichas reales del sistema hacia cualquier user del admin. Cada carga queda auditada con el bypass de scope.',
    risk: 'medium',
  },
  'wallet.unload_admin_network': {
    label: 'Retirar fichas — red del admin',
    what: 'Le permite retirar fichas desde la wallet de cualquier user de la red del admin hacia la wallet del actor. Motivo obligatorio.',
    consequence: 'Puede sacar saldo a jugadores/cajeros del admin. Alta sensibilidad — auditá el motivo con cada uso.',
    risk: 'high',
  },
  'wallet.correct_admin_network': {
    label: 'Cargas por corrección — red del admin',
    what: 'Le permite cargar fichas por corrección / bonificación / reintegro a cualquier user de la red del admin (Casa, socios dependientes, cajeros, jugadores). Las fichas salen de la Casa (no de su wallet), hasta el tope del cupo mensual. NO alcanza a la sub-red del socio independiente.',
    consequence: 'Puede regalar fichas a clientes del admin hasta agotar su cupo del mes. El cupo es el techo del daño: si le ponés $50.000/mes, ese es lo máximo que puede mover. Sin cupo asignado (0), el permiso queda inerte. Cada carga queda auditada con severity high y el bypass de scope.',
    risk: 'medium',
  },
  'wallet.view_admin_network': {
    label: 'Ver wallets — red del admin',
    what: 'Le permite ver el saldo y las transacciones de cualquier user de la red del admin. Alternativa a "Ver saldo de cualquier usuario" para el comodín (respeta el aislamiento del independiente).',
    consequence: 'Solo lectura, pero expone montos, movimientos y contrapartes de todos los users del admin.',
    risk: 'low',
  },
  'deposits.approve_admin_network': {
    label: 'Aprobar depósitos — red del admin',
    what: 'Le permite aprobar depósitos pendientes de cualquier user de la red del admin (Casa, socios dependientes, jugadores).',
    consequence: 'Acredita fichas al user y deja constancia en la cola de solicitudes. Cada aprobación queda auditada con el bypass de scope.',
    risk: 'medium',
  },
  'deposits.reject_admin_network': {
    label: 'Rechazar depósitos — red del admin',
    what: 'Le permite rechazar depósitos pendientes de cualquier user de la red del admin (con motivo).',
    consequence: 'Marca el depósito como rechazado y notifica al user. El comprobante queda descartado.',
    risk: 'low',
  },
  'deposits.view_admin_network': {
    label: 'Ver depósitos — red del admin',
    what: 'Le permite ver el listado, el detalle y el export de depósitos de cualquier user de la red del admin (no de la sub-red del independiente).',
    consequence: 'Solo lectura. Expone montos, comprobantes y estados de todos los depósitos del admin.',
    risk: 'low',
  },
  'withdrawals.approve_admin_network': {
    label: 'Aprobar retiros — red del admin',
    what: 'Le permite aprobar retiros pendientes de cualquier user de la red del admin. Mantiene el hold sobre las fichas hasta que se marca como pagado.',
    consequence: 'Habilita el pago. La ejecución (mark-paid) va aparte con "Marcar retiros como pagados — red del admin".',
    risk: 'medium',
  },
  'withdrawals.reject_admin_network': {
    label: 'Rechazar retiros — red del admin',
    what: 'Le permite rechazar retiros pendientes de cualquier user de la red del admin (con motivo). Libera el hold de fichas al user.',
    consequence: 'Libera el hold y notifica al user.',
    risk: 'low',
  },
  'withdrawals.process_admin_network': {
    label: 'Marcar retiros como pagados — red del admin',
    what: 'Le permite marcar como pagado (o fallido) un retiro aprobado en cualquier user de la red del admin. Registra referencia externa.',
    consequence: 'Sale plata real del sistema hacia el user. Alta sensibilidad — audit severity high y motivo obligatorio en el caso fail.',
    risk: 'high',
  },
  'withdrawals.view_admin_network': {
    label: 'Ver retiros — red del admin',
    what: 'Le permite ver el listado, el detalle y el export de retiros de cualquier user de la red del admin.',
    consequence: 'Solo lectura. Expone montos, referencias externas y estados de todos los retiros del admin.',
    risk: 'low',
  },
  'bonuses.grant_manual_admin_network': {
    label: 'Otorgar bonos manuales — red del admin',
    what: 'Le permite crear un bono manual (welcome, reload, compensación) para cualquier user de la red del admin. Antifraude soft se aplica igual.',
    consequence: 'Emite fichas atadas a wagering. Con overuso puede vaciar la caja del funder — el rate-limit y el audit high siguen activos.',
    risk: 'medium',
  },
  'bonuses.cancel_admin_network': {
    label: 'Cancelar bonos — red del admin',
    what: 'Le permite cancelar bonos activos de cualquier user de la red del admin. Revierte fichas restantes al funder y notifica al dueño.',
    consequence: 'Cancela un beneficio ya otorgado. Audit severity high.',
    risk: 'medium',
  },
};

/**
 * Convierte un code sin metadata curada en un nombre legible como fallback.
 * Ej: "wallet.super_power" → "Wallet · super power".
 */
function humanizeCode(code: string): string {
  return code
    .split('.')
    .map((part) => part.replace(/_/g, ' '))
    .join(' · ');
}

/**
 * Metadata amigable de un permiso. Si no hay entrada curada (permiso nuevo en
 * el seed sin copy acá), devuelve un fallback CONSERVADOR: riesgo alto + aviso
 * de "sin descripción", para que nadie otorgue a ciegas algo desconocido.
 */
export function getPermissionMeta(code: string): PermissionMeta {
  const meta = PERMISSION_META[code];
  if (meta) return meta;
  return {
    label: humanizeCode(code),
    what: 'Permiso del sistema sin descripción amigable todavía.',
    consequence: 'No tenemos una explicación clara de este permiso. Revisalo con cuidado o consultá antes de otorgarlo.',
    risk: 'high',
  };
}

/** Solo el nombre amigable (con fallback humanizado). */
export function getPermissionLabel(code: string): string {
  return PERMISSION_META[code]?.label ?? humanizeCode(code);
}

/** Nombre amigable de una categoría (con fallback al código). */
export function getCategoryLabel(category: string | null | undefined): string {
  if (!category) return CATEGORY_LABELS.otros ?? 'Otros';
  return CATEGORY_LABELS[category] ?? category;
}
