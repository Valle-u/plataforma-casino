/**
 * E2E: diseño por socio independiente — resolución en /tenant/info.
 *
 * Verifica que:
 *   - Sin ?ref → el visitante ve el diseño DEFAULT del tenant.
 *   - Con ?ref=<socio> → ve el diseño propio del socio independiente.
 *
 * (El camino "jugador logueado por token" comparte la misma resolución interna
 *  —resolveDesignOwner→config— que el ?ref, así que este test cubre el núcleo.)
 */

import postgres from 'postgres';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { getTestTenantUrl } from '../setup/db-helpers';
import { TEST_TENANT } from '../setup/test-tenant';

const SOCIO_CODE = 'juanindep';
const MARKER = 'CASINO DE JUAN';
const ACCENT = '#123456';

// Segundo socio: configura EXPLÍCITAMENTE la apariencia del panel.
const SOCIO2_CODE = 'anaindep';
const PANEL_ACCENT = '#abcdef';
const PANEL_BG = '#101010';

async function seedSocioWithDesign(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const u = await sql<{ id: string }[]>`
      INSERT INTO users (id, username, display_name, password_hash, status, is_independent_branch, referral_code)
      VALUES (gen_random_uuid(), ${SOCIO_CODE}, 'Juan Indep', 'test-no-login', 'active', true, ${SOCIO_CODE})
      RETURNING id
    `;
    const socioId = u[0]!.id;
    await sql`
      INSERT INTO partner_branding (id, owner_user_id, config)
      VALUES (
        gen_random_uuid(), ${socioId},
        ${sql.json({ brand: { platformName: MARKER }, colors: { accent: ACCENT } })}
      )
    `;

    const u2 = await sql<{ id: string }[]>`
      INSERT INTO users (id, username, display_name, password_hash, status, is_independent_branch, referral_code)
      VALUES (gen_random_uuid(), ${SOCIO2_CODE}, 'Ana Indep', 'test-no-login', 'active', true, ${SOCIO2_CODE})
      RETURNING id
    `;
    const socio2Id = u2[0]!.id;
    await sql`
      INSERT INTO partner_branding (id, owner_user_id, config)
      VALUES (
        gen_random_uuid(), ${socio2Id},
        ${sql.json({
          colors: { accentColor: ACCENT },
          adminAppearance: { accent: PANEL_ACCENT, bg: PANEL_BG },
        })}
      )
    `;
  } finally {
    await sql.end();
  }
}

interface InfoResponse {
  design: { brand?: { platformName?: string } | null } | null;
  branding: { primaryColor: string | null };
  adminAppearance: { accent: string; bg: string } | null;
}

describe('Partner design resolution (E2E)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    await seedSocioWithDesign();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('sin ?ref → NO muestra el diseño del socio (default del tenant)', async () => {
    const res = await ctx.request.get('/tenant/info').set('Host', TEST_TENANT.host);
    expect(res.status).toBe(200);
    const body = res.body as InfoResponse;
    expect(body.design?.brand?.platformName).not.toBe(MARKER);
  });

  it('con ?ref=<socio> → muestra el diseño propio del socio', async () => {
    const res = await ctx.request
      .get(`/tenant/info?ref=${SOCIO_CODE}`)
      .set('Host', TEST_TENANT.host);
    expect(res.status).toBe(200);
    const body = res.body as InfoResponse;
    expect(body.design?.brand?.platformName).toBe(MARKER);
    expect(body.branding.primaryColor).toBe(ACCENT);
  });

  it('con ?ref de un código inexistente → cae al default (no rompe)', async () => {
    const res = await ctx.request
      .get('/tenant/info?ref=no_existe_xyz')
      .set('Host', TEST_TENANT.host);
    expect(res.status).toBe(200);
    const body = res.body as InfoResponse;
    expect(body.design?.brand?.platformName).not.toBe(MARKER);
  });

  it('panel del socio SIN config propia → auto-adopta su acento de marca', async () => {
    const res = await ctx.request
      .get(`/tenant/info?ref=${SOCIO_CODE}`)
      .set('Host', TEST_TENANT.host);
    expect(res.status).toBe(200);
    const body = res.body as InfoResponse;
    // El socio 1 no configuró el panel → adopta su acento (#123456).
    expect(body.adminAppearance?.accent).toBe(ACCENT);
  });

  it('panel del socio CON config propia → usa esa apariencia explícita', async () => {
    const res = await ctx.request
      .get(`/tenant/info?ref=${SOCIO2_CODE}`)
      .set('Host', TEST_TENANT.host);
    expect(res.status).toBe(200);
    const body = res.body as InfoResponse;
    expect(body.adminAppearance?.accent).toBe(PANEL_ACCENT);
    expect(body.adminAppearance?.bg).toBe(PANEL_BG);
  });
});
