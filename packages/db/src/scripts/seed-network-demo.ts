/**
 * seed-network-demo — arma una red COMPLETA de prueba en un tenant.
 *
 * Para qué: poder entrar al panel con cada rol y ver pantallas con datos
 * reales. Con dos usuarios (admin + Casa) no se puede evaluar nada: la vista de
 * red está vacía, la cola de pedidos vacía, el árbol de jerarquía vacío.
 *
 * ⚠️ **SOLO PARA STAGING / DEV.** Crea decenas de usuarios con una contraseña
 * conocida y fija. Corrrerlo en producción sería abrir el casino de par en par,
 * así que hay dos frenos abajo (ver `asegurarQueNoEsProduccion`).
 *
 * Uso, desde adentro del contenedor de la API:
 *
 *   pnpm --filter @casino/db exec tsx src/scripts/seed-network-demo.ts \
 *     --slug=staging --yes
 *
 * Idempotente por username: si un usuario ya existe se saltea, así que se puede
 * volver a correr para completar una corrida interrumpida.
 *
 * ---
 *
 * LO QUE ARMA, y por qué así
 *
 * La red sigue las convenciones de `TenantUsersController` —los mismos
 * `relation_type` que escribe la app— para que el panel la lea igual que si la
 * hubieran armado a mano. Si esto inventara sus propias etiquetas, las pantallas
 * de red mostrarían cualquier cosa y la prueba no valdría.
 *
 *   Casa (admin)
 *   ├── empleados ................ 3, distintos perfiles
 *   ├── jugadores de la Casa ..... 6   (`jugador_de_admin`, sin comisión)
 *   ├── socio dependiente A ...... 2 distribuidores + 2 cajeros directos
 *   ├── socio dependiente B ...... idem
 *   ├── socio dependiente C ...... idem
 *   └── socio INDEPENDIENTE D .... su propia sub-red aislada (E8/P3)
 *
 * Cada distribuidor lleva 3 cajeros, y cada cajero 4 jugadores. Da ~200
 * usuarios: suficiente para que las listas paginen y los árboles tengan
 * profundidad real, sin que el seed tarde una eternidad.
 *
 * **El socio D es independiente a propósito.** Es el caso que más fácil se
 * rompe —su sub-red no la puede ver ni fondear nadie de afuera (E8/P3)— y sin
 * uno en la base ese aislamiento no se puede probar mirando el panel.
 *
 * **Los estados se reparten**: la mayoría `active`, algunos `suspended` e
 * `inactive`. Una lista donde todos están activos no muestra si los filtros y
 * los badges funcionan.
 *
 * ---
 *
 * EL DINERO, Y POR QUÉ NO ALCANZA CON PONER UN BALANCE
 *
 * El invariante del ledger es `balance == Σ(créditos) − Σ(débitos)`
 * (`verify-money-clean.ts`). Escribir un balance a mano lo rompe, y el chequeo
 * de conciliación empezaría a marcar descuadres en todos lados — ruido que
 * después hay que salir a explicar.
 *
 * Así que toda ficha entra por donde entraría de verdad: la Casa mintea, carga
 * a los operadores, y los operadores cargan a los jugadores. Cada movimiento
 * deja su fila en `wallet_transactions` con su `balance_after`.
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });

import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { createControlDb, createTenantDb } from '../client';
import {
  HOUSE_USERNAME,
  paymentMethods,
  roles,
  userHierarchy,
  userRoles,
  users,
  walletTransactions,
  wallets,
} from '../tenant';
import { tenants } from '../control';
import { hashPassword } from '../utils/password';

/** La misma para todos: esto es un entorno de prueba, no hay nada que proteger. */
const PASSWORD = 'Staging2026!';

const CANT = {
  empleados: 3,
  jugadoresDeLaCasa: 6,
  distribuidoresPorSocio: 2,
  cajerosPorDistribuidor: 3,
  cajerosDirectosPorSocio: 2,
  jugadoresPorCajero: 4,
  jugadoresPorDistribuidor: 2,
  jugadoresPorSocio: 2,
} as const;

const SOCIOS = [
  { slug: 'norte', nombre: 'Socio Norte', independiente: false, comision: '15.00' },
  { slug: 'sur', nombre: 'Socio Sur', independiente: false, comision: '12.50' },
  { slug: 'centro', nombre: 'Socio Centro', independiente: false, comision: '10.00' },
  { slug: 'litoral', nombre: 'Socio Litoral', independiente: true, comision: '18.00' },
] as const;

type Estado = 'active' | 'suspended' | 'inactive';

/**
 * Reparte estados de forma determinística: 1 de cada 12 suspendido, 1 de cada
 * 17 inactivo. Números primos entre sí para que no caigan siempre en el mismo
 * usuario de cada rama.
 */
function estadoDe(i: number): Estado {
  if (i > 0 && i % 12 === 0) return 'suspended';
  if (i > 0 && i % 17 === 0) return 'inactive';
  return 'active';
}

interface Ctx {
  db: ReturnType<typeof createTenantDb>;
  rolesPorCodigo: Map<string, string>;
  passwordHash: string;
  adminId: string;
  casaId: string;
  creados: number;
  salteados: number;
}

async function crearUsuario(
  ctx: Ctx,
  params: {
    username: string;
    displayName: string;
    roleCode: string;
    parentUserId: string;
    relationType: string;
    estado?: Estado;
    independiente?: boolean;
    comision?: string;
  },
): Promise<{ id: string; nuevo: boolean } | null> {
  const yaEsta = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, params.username))
    .limit(1);
  if (yaEsta[0]) {
    ctx.salteados += 1;
    return { id: yaEsta[0].id, nuevo: false };
  }

  const roleId = ctx.rolesPorCodigo.get(params.roleCode);
  if (!roleId) throw new Error(`El rol "${params.roleCode}" no existe en este tenant.`);

  const insertado = await ctx.db
    .insert(users)
    .values({
      username: params.username,
      displayName: params.displayName,
      email: `${params.username}@staging.local`,
      passwordHash: ctx.passwordHash,
      status: params.estado ?? 'active',
      // Sólo los socios llevan estos dos. `is_independent_branch` es lo que
      // separa una sub-red aislada de una dependiente (E8/P3).
      ...(params.roleCode === 'socio'
        ? {
            isIndependentBranch: params.independiente ?? false,
            // `commission_rate` es NOT NULL con default: se omite en vez de
            // mandar null, que la tipa como inválida.
            ...(params.comision ? { commissionRate: params.comision } : {}),
            ...(params.independiente
              ? { branchBankAccount: `0000076500000${Math.floor(Math.random() * 900000) + 100000}` }
              : {}),
          }
        : {}),
      // El código de referido es el username, igual que en la app.
      ...(params.roleCode !== 'usuario_final'
        ? { referralCode: params.username, referralCodeGeneratedAt: new Date() }
        : {}),
    })
    .returning({ id: users.id });

  const userId = insertado[0]!.id;

  await ctx.db.insert(userRoles).values({ userId, roleId, grantedBy: ctx.adminId });

  await ctx.db.insert(userHierarchy).values({
    userId,
    parentUserId: params.parentUserId,
    relationType: params.relationType,
  });

  ctx.creados += 1;
  return { id: userId, nuevo: true };
}

/**
 * Mueve fichas dejando el rastro contable. `desde === null` = las mintea la
 * Casa (única fuente de fichas, docs/16).
 */
async function moverFichas(
  ctx: Ctx,
  params: { desde: string | null; hacia: string; monto: number; motivo: string },
): Promise<void> {
  const walletDe = async (userId: string): Promise<{ id: string; balance: number }> => {
    const existente = await ctx.db
      .select({ id: wallets.id, balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .limit(1);
    if (existente[0]) {
      return { id: existente[0].id, balance: Number(existente[0].balance) };
    }
    const nueva = await ctx.db
      .insert(wallets)
      .values({ userId })
      .returning({ id: wallets.id, balance: wallets.balance });
    return { id: nueva[0]!.id, balance: Number(nueva[0]!.balance) };
  };

  const destino = await walletDe(params.hacia);

  if (params.desde) {
    const origen = await walletDe(params.desde);
    if (origen.balance < params.monto) {
      throw new Error(
        `El origen no tiene fichas suficientes (${origen.balance} < ${params.monto}). ` +
          'Se está cargando en un orden que no respeta de dónde viene la plata.',
      );
    }
    const saldoOrigen = origen.balance - params.monto;
    await ctx.db
      .update(wallets)
      .set({ balance: saldoOrigen.toFixed(2), updatedAt: new Date() })
      .where(eq(wallets.id, origen.id));
    await ctx.db.insert(walletTransactions).values({
      walletId: origen.id,
      type: 'transfer_out',
      amount: params.monto.toFixed(2),
      balanceAfter: saldoOrigen.toFixed(2),
      counterpartyUserId: params.hacia,
      source: 'seed_network_demo',
      idempotencyKey: randomUUID(),
      createdBy: ctx.adminId,
      reason: params.motivo,
    });
  }

  const saldoDestino = destino.balance + params.monto;
  await ctx.db
    .update(wallets)
    .set({ balance: saldoDestino.toFixed(2), updatedAt: new Date() })
    .where(eq(wallets.id, destino.id));
  await ctx.db.insert(walletTransactions).values({
    walletId: destino.id,
    // Sin origen es emisión pura: la Casa crea las fichas.
    type: params.desde ? 'transfer_in' : 'mint',
    amount: params.monto.toFixed(2),
    balanceAfter: saldoDestino.toFixed(2),
    counterpartyUserId: params.desde ?? null,
    source: 'seed_network_demo',
    idempotencyKey: randomUUID(),
    createdBy: ctx.adminId,
    reason: params.motivo,
  });
}

/**
 * Dos frenos para que esto no toque producción.
 *
 * El primero es el nombre de la base. El segundo es el `--yes`: obliga a
 * escribirlo, así no se dispara por una flecha arriba en la terminal
 * equivocada — que es exactamente como pasan estas cosas.
 */
function asegurarQueNoEsProduccion(dbName: string, argv: string[]): void {
  const PROHIBIDAS = ['tenant_miamihub'];
  if (PROHIBIDAS.includes(dbName)) {
    throw new Error(
      `NO. "${dbName}" es la base de PRODUCCIÓN. Este script crea usuarios con ` +
        'una contraseña fija y conocida; correrlo acá sería abrir el casino.',
    );
  }
  if (!argv.includes('--yes')) {
    throw new Error(
      `Falta --yes. Va a escribir sobre "${dbName}": confirmá que es la que querés.`,
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const slug = (argv.find((a) => a.startsWith('--slug='))?.split('=')[1] ?? '').trim();
  if (!slug) throw new Error('Falta --slug=<tenant>. Ej: --slug=staging');

  const controlUrl = process.env.DATABASE_URL_CONTROL;
  if (!controlUrl) throw new Error('Falta DATABASE_URL_CONTROL.');

  const controlDb = createControlDb(controlUrl);
  const fila = await controlDb
    .select({ dbName: tenants.dbName })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  const dbName = fila[0]?.dbName;
  if (!dbName) throw new Error(`No existe un tenant con slug "${slug}".`);

  asegurarQueNoEsProduccion(dbName, argv);

  const tenantUrl = controlUrl.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);
  const db = createTenantDb(tenantUrl);

  const rolesRows = await db.select({ id: roles.id, code: roles.code }).from(roles);
  const rolesPorCodigo = new Map(rolesRows.map((r) => [r.code, r.id]));

  const adminRow = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(eq(userRoles.roleId, rolesPorCodigo.get('admin_tenant')!))
    .limit(1);
  const admin = adminRow[0];
  if (!admin) throw new Error('Este tenant no tiene admin_tenant. ¿Está seedeado?');

  const casaRow = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, HOUSE_USERNAME))
    .limit(1);
  if (!casaRow[0]) throw new Error('No existe la cuenta de sistema Casa.');

  const ctx: Ctx = {
    db,
    rolesPorCodigo,
    passwordHash: await hashPassword(PASSWORD),
    adminId: admin.id,
    casaId: casaRow[0].id,
    creados: 0,
    salteados: 0,
  };

  console.log(`\n▶ Tenant "${slug}" (${dbName}) · admin: ${admin.username}\n`);

  // ── Fondeo inicial de la Casa ────────────────────────────────────────────
  // Todo lo demás sale de acá. Si la Casa no tiene fichas, no hay red.
  //
  // Sólo si le falta: mintear de nuevo en cada corrida inflaría las fichas en
  // circulación sin que nadie lo pida, y ese número es justamente el que se
  // mira para saber si la contabilidad cierra.
  const FONDEO_CASA = 50_000_000;
  const saldoCasa = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.userId, ctx.casaId))
    .limit(1);
  if (Number(saldoCasa[0]?.balance ?? 0) < FONDEO_CASA / 2) {
    await moverFichas(ctx, {
      desde: null,
      hacia: ctx.casaId,
      monto: FONDEO_CASA,
      motivo: 'Fondeo inicial de la red de prueba',
    });
    console.log(`  Casa fondeada con ${FONDEO_CASA.toLocaleString('es-AR')} fichas.`);
  } else {
    console.log('  La Casa ya tenía fondos: no se mintea de nuevo.');
  }

  // ── Empleados ────────────────────────────────────────────────────────────
  for (let i = 1; i <= CANT.empleados; i++) {
    await crearUsuario(ctx, {
      username: `empleado_${i}`,
      displayName: `Empleado ${i}`,
      roleCode: 'empleado',
      parentUserId: ctx.adminId,
      relationType: 'empleado',
      estado: estadoDe(i),
    });
  }
  console.log(`  ${CANT.empleados} empleados.`);

  // ── Jugadores de la Casa ─────────────────────────────────────────────────
  // Cuelgan del admin. El motor de comisiones lo excluye, así que no generan
  // comisión: es el equivalente al registro orgánico.
  for (let i = 1; i <= CANT.jugadoresDeLaCasa; i++) {
    const id = await crearUsuario(ctx, {
      username: `jug_casa_${i}`,
      displayName: `Jugador Casa ${i}`,
      roleCode: 'usuario_final',
      parentUserId: ctx.adminId,
      relationType: 'jugador_de_admin',
      estado: estadoDe(i),
    });
    // Sólo se carga a los recién creados: si no, una segunda corrida les
    // volvería a depositar y los saldos se irían duplicando.
    if (id?.nuevo) {
      await moverFichas(ctx, {
        desde: ctx.casaId,
        hacia: id.id,
        monto: 1000 + i * 250,
        motivo: 'Carga inicial',
      });
    }
  }
  console.log(`  ${CANT.jugadoresDeLaCasa} jugadores de la Casa.`);

  // ── Socios y sus redes ───────────────────────────────────────────────────
  let n = 0;
  for (const socio of SOCIOS) {
    const socioId = await crearUsuario(ctx, {
      username: `socio_${socio.slug}`,
      displayName: socio.nombre,
      roleCode: 'socio',
      parentUserId: ctx.adminId,
      relationType: 'socio_de_admin',
      independiente: socio.independiente,
      comision: socio.comision,
    });
    if (!socioId) continue;

    if (socioId.nuevo) {
      await moverFichas(ctx, {
        desde: ctx.casaId,
        hacia: socioId.id,
        monto: 2_000_000,
        motivo: 'Cupo del socio',
      });
    }

    const cajerosDelSocio: string[] = [];

    // Distribuidores, y los cajeros que cuelgan de ellos.
    for (let d = 1; d <= CANT.distribuidoresPorSocio; d++) {
      const distId = await crearUsuario(ctx, {
        username: `dist_${socio.slug}_${d}`,
        displayName: `Distribuidor ${socio.nombre} ${d}`,
        roleCode: 'distribuidor',
        parentUserId: socioId.id,
        relationType: 'distribuidor_de_socio',
        estado: estadoDe(++n),
      });
      if (!distId) continue;

      if (distId.nuevo) {
        await moverFichas(ctx, {
          desde: socioId.id,
          hacia: distId.id,
          monto: 300_000,
          motivo: 'Cupo del distribuidor',
        });
      }

      for (let c = 1; c <= CANT.cajerosPorDistribuidor; c++) {
        const cajId = await crearUsuario(ctx, {
          username: `caj_${socio.slug}_d${d}_${c}`,
          displayName: `Cajero ${socio.nombre} D${d}-${c}`,
          roleCode: 'cajero',
          parentUserId: distId.id,
          relationType: 'cajero_de_distribuidor',
          estado: estadoDe(++n),
        });
        if (cajId) {
          if (cajId.nuevo) {
            await moverFichas(ctx, {
              desde: distId.id,
              hacia: cajId.id,
              monto: 60_000,
              motivo: 'Cupo del cajero',
            });
          }
          // Se acumula SIEMPRE, exista o no de antes: de esta lista salen los
          // jugadores de más abajo. Si sólo se agregaran los nuevos, una
          // corrida interrumpida y retomada dejaría a esos cajeros sin ningún
          // jugador, que es justo lo que la idempotencia tiene que evitar.
          cajerosDelSocio.push(cajId.id);
        }
      }

      // Algún jugador cuelga directo del distribuidor: pasa en la vida real y
      // ejercita `jugador_de_distribuidor`.
      for (let j = 1; j <= CANT.jugadoresPorDistribuidor; j++) {
        const jugId = await crearUsuario(ctx, {
          username: `jug_${socio.slug}_d${d}_${j}`,
          displayName: `Jugador ${socio.nombre} D${d}-${j}`,
          roleCode: 'usuario_final',
          parentUserId: distId.id,
          relationType: 'jugador_de_distribuidor',
          estado: estadoDe(++n),
        });
        if (jugId?.nuevo) {
          await moverFichas(ctx, {
            desde: distId.id,
            hacia: jugId.id,
            monto: 500 + j * 300,
            motivo: 'Carga del distribuidor',
          });
        }
      }
    }

    // Cajeros que cuelgan directo del socio, sin distribuidor en el medio.
    for (let c = 1; c <= CANT.cajerosDirectosPorSocio; c++) {
      const cajId = await crearUsuario(ctx, {
        username: `caj_${socio.slug}_s${c}`,
        displayName: `Cajero ${socio.nombre} S${c}`,
        roleCode: 'cajero',
        parentUserId: socioId.id,
        relationType: 'cajero_de_socio',
        estado: estadoDe(++n),
      });
      if (cajId) {
        if (cajId.nuevo) {
          await moverFichas(ctx, {
            desde: socioId.id,
            hacia: cajId.id,
            monto: 80_000,
            motivo: 'Cupo del cajero',
          });
        }
        cajerosDelSocio.push(cajId.id);
      }
    }

    // Jugadores directos del socio.
    for (let j = 1; j <= CANT.jugadoresPorSocio; j++) {
      const jugId = await crearUsuario(ctx, {
        username: `jug_${socio.slug}_s${j}`,
        displayName: `Jugador ${socio.nombre} S${j}`,
        roleCode: 'usuario_final',
        parentUserId: socioId.id,
        relationType: 'jugador_de_socio',
        estado: estadoDe(++n),
      });
      if (jugId?.nuevo) {
        await moverFichas(ctx, {
          desde: socioId.id,
          hacia: jugId.id,
          monto: 700 + j * 400,
          motivo: 'Carga del socio',
        });
      }
    }

    // Jugadores de cada cajero: el grueso de la red.
    let jn = 0;
    for (const cajId of cajerosDelSocio) {
      for (let j = 1; j <= CANT.jugadoresPorCajero; j++) {
        jn += 1;
        const jugId = await crearUsuario(ctx, {
          username: `jug_${socio.slug}_c${jn}`,
          displayName: `Jugador ${socio.nombre} ${jn}`,
          roleCode: 'usuario_final',
          parentUserId: cajId,
          relationType: 'jugador_de_cajero',
          estado: estadoDe(++n),
        });
        if (jugId?.nuevo) {
          await moverFichas(ctx, {
            desde: cajId,
            hacia: jugId.id,
            monto: 300 + (jn % 7) * 250,
            motivo: 'Carga del cajero',
          });
        }
      }
    }

    console.log(
      `  Red de ${socio.nombre}${socio.independiente ? ' (INDEPENDIENTE)' : ''} lista.`,
    );
  }

  // ── Un método de pago, para que la pantalla no esté vacía ────────────────
  const pmExiste = await db
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .limit(1);
  if (!pmExiste[0]) {
    await db.insert(paymentMethods).values({
      code: 'transferencia_ars',
      name: 'Transferencia bancaria (ARS)',
      type: 'bank_transfer',
      chipsPerUnit: '1',
      isActive: true,
    });
    console.log('  Método de pago de prueba creado.');
  }

  // ── Resumen ──────────────────────────────────────────────────────────────
  const total = await db.select({ id: users.id }).from(users);
  const circulante = await db.select({ balance: wallets.balance }).from(wallets);
  const enCirculacion = circulante.reduce((a, w) => a + Number(w.balance), 0);

  console.log(`\n✓ Listo.`);
  console.log(`  Usuarios creados en esta corrida: ${ctx.creados}`);
  console.log(`  Ya existían (salteados):          ${ctx.salteados}`);
  console.log(`  Usuarios en el tenant:            ${total.length}`);
  console.log(`  Fichas en circulación:            ${enCirculacion.toLocaleString('es-AR')}`);
  console.log(`\n  Contraseña de TODOS: ${PASSWORD}`);
  console.log('  Usuarios: empleado_1..3 · socio_norte|sur|centro|litoral ·');
  console.log('            dist_<socio>_<n> · caj_<socio>_d<n>_<n> · caj_<socio>_s<n> ·');
  console.log('            jug_casa_<n> · jug_<socio>_c<n>\n');
  console.log('  socio_litoral es el INDEPENDIENTE: su sub-red está aislada (E8/P3).\n');

  await postgres(tenantUrl, { max: 1 }).end();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(1);
});
