/**
 * E2E: la migración `0112` (dueño del canal y del contacto) se aplicó de verdad.
 *
 * ## Por qué existe
 *
 * Las migraciones de tenant se registran **a mano** en
 * `packages/db/migrations/tenant/meta/_journal.json`. Si el archivo `.sql`
 * existe pero su entrada en el journal falta o tiene el `tag` mal escrito,
 * **drizzle la saltea sin decir nada**: no hay error, no hay warning, el
 * bootstrap termina bien y la columna simplemente no está.
 *
 * Y eso no se nota hasta mucho después, porque los tests que hoy tocan el CRM
 * **no leen la columna todavía** — pasarían igual con la migración aplicada o
 * sin aplicar. El día que el código empiece a usarla, el error aparece en
 * producción y no acá.
 *
 * Por eso esto no verifica lógica: verifica que **la migración corrió**.
 *
 * Vale para toda migración de tenant que agregue algo y no se use enseguida.
 */

import postgres from 'postgres';
import { getTestTenantUrl } from '../setup/db-helpers';

let conexion: ReturnType<typeof postgres> | null = null;
function db() {
  conexion ??= postgres(getTestTenantUrl(), { max: 1, connect_timeout: 10 });
  return conexion;
}

afterAll(async () => {
  const c = conexion;
  conexion = null;
  if (c) await c.end({ timeout: 5 });
});

describe('migración 0112 · dueño del canal y del contacto', () => {
  it('las dos columnas existen y son nullable', async () => {
    const filas = await db()<
      Array<{ table_name: string; is_nullable: string }>
    >`
      SELECT table_name, is_nullable
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('crm_contacts', 'crm_channels')
         AND column_name = 'owner_user_id'
       ORDER BY table_name
    `;

    expect(filas.map((f) => f.table_name)).toEqual([
      'crm_channels',
      'crm_contacts',
    ]);
    // Nullable no es un detalle: `NULL` ES el valor que significa "central".
    // Una columna NOT NULL haría imposible representar un canal del casino.
    for (const f of filas) expect(f.is_nullable).toBe('YES');
  });

  it('los índices que necesita el ruteo están creados', async () => {
    const filas = await db()<Array<{ indexname: string }>>`
      SELECT indexname
        FROM pg_indexes
       WHERE tablename IN ('crm_contacts', 'crm_channels')
         AND indexname IN (
           'crm_channels_owner_idx',
           'crm_contacts_owner_phone_idx'
         )
       ORDER BY indexname
    `;

    expect(filas.map((f) => f.indexname)).toEqual([
      'crm_channels_owner_idx',
      'crm_contacts_owner_phone_idx',
    ]);
  });

  it('el teléfono NO es único: el mismo número vive en varias bandejas (D6)', async () => {
    // Si alguien agregara un UNIQUE sobre `phone` "para evitar duplicados",
    // rompería D6 de la peor forma: el segundo contacto no se podría ni crear,
    // y el mensaje de una persona real se perdería con un error de base.
    const filas = await db()<Array<{ indexdef: string }>>`
      SELECT indexdef
        FROM pg_indexes
       WHERE tablename = 'crm_contacts'
         AND indexdef ILIKE '%unique%'
         AND indexdef ILIKE '%phone%'
    `;

    expect(filas).toHaveLength(0);
  });

  it('borrar al dueño no borra sus contactos: los deja centrales (ON DELETE SET NULL)', async () => {
    // Es el comportamiento elegido y conviene fijarlo, porque tiene una
    // consecuencia que no se ve: los contactos de ese operador pasarían a la
    // bandeja del staff central en silencio. Hoy no es un riesgo real —los
    // usuarios no se borran, se desactivan— pero si alguien agrega el borrado
    // duro, esto es lo que va a pasar.
    const filas = await db()<Array<{ confdeltype: string }>>`
      SELECT c.confdeltype
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
       WHERE c.contype = 'f'
         AND t.relname IN ('crm_contacts', 'crm_channels')
         AND a.attname = 'owner_user_id'
    `;

    expect(filas).toHaveLength(2);
    // 'n' = SET NULL en pg_constraint.confdeltype.
    for (const f of filas) expect(f.confdeltype).toBe('n');
  });
});
