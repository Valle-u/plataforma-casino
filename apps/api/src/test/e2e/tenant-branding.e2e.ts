/**
 * E2E: Branding del tenant (Sprint 29).
 *
 * Cubre:
 *   - `GET /tenant/info` devuelve `branding: { primaryColor, logoUrl }`.
 *     Sin settings → ambos null. Con settings → los valores reales.
 *   - `PATCH /tenant/settings/branding.primary_color` valida hex #RRGGBB.
 *   - `PATCH /tenant/settings/branding.logo_url` valida URL https.
 *   - Endpoint `/info` sigue siendo público (no auth) post-branding.
 *
 * Aislamiento: los settings se borran en beforeEach para que cada caso
 * empiece limpio. Sin contaminación cross-test.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';

describe('Tenant branding (E2E, Sprint 29)', () => {
  let ctx: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.tenantDb.execute(
      sql`DELETE FROM tenant_settings WHERE key LIKE 'branding.%'`,
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  // GET /tenant/info
  // ──────────────────────────────────────────────────────────────────────

  describe('GET /tenant/info', () => {
    it('sin branding settings → branding.primaryColor + logoUrl = null', async () => {
      const res = await ctx.request
        .get('/tenant/info')
        .set('Host', TEST_TENANT.host);
      expect(res.status).toBe(200);
      const body = res.body as {
        tenant: { slug: string };
        branding: {
          primaryColor: string | null;
          logoUrl: string | null;
          faviconUrl: string | null;
          tagline: string | null;
        };
      };
      expect(body.tenant.slug).toBe(TEST_TENANT.slug);
      expect(body.branding).toEqual({
        primaryColor: null,
        logoUrl: null,
        faviconUrl: null,
        tagline: null,
      });
    });

    it('con settings configuradas → branding refleja los valores', async () => {
      // Set ambas settings vía API admin.
      const r1 = await ctx.request
        .patch('/tenant/settings/branding.primary_color')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: '#ff5733' });
      expect(r1.status).toBe(200);

      const r2 = await ctx.request
        .patch('/tenant/settings/branding.logo_url')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 'https://cdn.example.com/logo.png' });
      expect(r2.status).toBe(200);

      const res = await ctx.request
        .get('/tenant/info')
        .set('Host', TEST_TENANT.host);
      expect(res.status).toBe(200);
      const body = res.body as {
        branding: { primaryColor: string; logoUrl: string };
      };
      expect(body.branding.primaryColor).toBe('#ff5733');
      expect(body.branding.logoUrl).toBe('https://cdn.example.com/logo.png');
    });

    it('endpoint sigue siendo público (sin auth)', async () => {
      const res = await ctx.request
        .get('/tenant/info')
        .set('Host', TEST_TENANT.host);
      // Sin Authorization header — debe devolver 200.
      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Validación Zod del registry
  // ──────────────────────────────────────────────────────────────────────

  describe('PATCH /tenant/settings/branding.primary_color', () => {
    it('acepta hex #RRGGBB', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/branding.primary_color')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: '#1a2b3c' });
      expect(res.status).toBe(200);
    });

    it('rechaza shorthand #RGB', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/branding.primary_color')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: '#abc' });
      expect(res.status).toBe(400);
    });

    it('rechaza hex sin #', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/branding.primary_color')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: '1a2b3c' });
      expect(res.status).toBe(400);
    });

    it('rechaza named colors', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/branding.primary_color')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 'red' });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /tenant/settings/branding.logo_url', () => {
    it('acepta URL HTTPS', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/branding.logo_url')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 'https://cdn.example.com/logo.png' });
      expect(res.status).toBe(200);
    });

    it('rechaza HTTP sin S', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/branding.logo_url')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 'http://cdn.example.com/logo.png' });
      expect(res.status).toBe(400);
    });

    it('rechaza string que no es URL', async () => {
      const res = await ctx.request
        .patch('/tenant/settings/branding.logo_url')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ value: 'just-a-filename.png' });
      expect(res.status).toBe(400);
    });
  });
});
