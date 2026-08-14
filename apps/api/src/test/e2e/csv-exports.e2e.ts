/**
 * E2E: Sprint 9 — Exports CSV transversales.
 *
 * Cubre los 6 endpoints '/export':
 *   - GET /tenant/audit-log/export
 *   - GET /tenant/bonuses/export
 *   - GET /tenant/deposits/export
 *   - GET /tenant/withdrawals/export
 *   - GET /tenant/users/export
 *   - GET /tenant/wallet/me/transactions/export
 *
 * Para cada uno valida:
 *   1. Permission gate: cajero (sin entity.export) responde 403.
 *   2. Admin responde 200 + Content-Type CSV + attachment.
 *   3. Body con BOM UTF-8 + headers en primera fila.
 *   4. Audit entry "entity.export" queda registrada (severity medium).
 */

import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';

interface AuditEntry {
  actionCode: string;
  actorUsername: string | null;
  metadata: { severity?: string; rowCount?: number; truncated?: boolean } | null;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
}

describe('CSV Exports (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let cajero1Token: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    cajero1Token = await loginAsCajero1(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** Helper: assert que el body sea CSV bien formado y tenga BOM. */
  function assertCsvShape(body: string, expectedHeaderToken: string) {
    expect(typeof body).toBe('string');
    // BOM UTF-8 al inicio.
    expect(body.charCodeAt(0)).toBe(0xfeff);
    // Header de columnas al inicio (después del BOM).
    expect(body.slice(1)).toContain(expectedHeaderToken);
  }

  /** Helper: cuenta cuántas audit entries con cierto actionCode hay después
   * del momento marcado (filtra desde-hasta). */
  async function countAuditEntries(actionCode: string): Promise<number> {
    const res = await ctx.request
      .get('/tenant/audit-log')
      .query({ actionCode, limit: 200 })
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    if (res.status !== 200) {
      throw new Error(
        `audit-log query falló: HTTP ${res.status} body=${JSON.stringify(res.body)}`,
      );
    }
    return (res.body as AuditResponse).entries.length;
  }

  describe('GET /tenant/audit-log/export', () => {
    it('cajero sin permiso → 403', async () => {
      const res = await ctx.request
        .get('/tenant/audit-log/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });

    it('admin → 200 CSV + audit entry', async () => {
      const before = await countAuditEntries('audit.export');
      const res = await ctx.request
        .get('/tenant/audit-log/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .buffer(true)
        .parse((response, cb) => {
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (raw += chunk));
          response.on('end', () => cb(null, raw));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(/attachment.*audit_log.*\.csv/);
      assertCsvShape(res.body as string, 'created_at,id,action_code');
      const after = await countAuditEntries('audit.export');
      expect(after).toBeGreaterThanOrEqual(before + 1);
    });
  });

  describe('GET /tenant/bonuses/export', () => {
    it('cajero sin permiso → 403', async () => {
      const res = await ctx.request
        .get('/tenant/bonuses/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });

    it('admin → 200 CSV + audit entry bonus.export', async () => {
      const before = await countAuditEntries('bonus.export');
      const res = await ctx.request
        .get('/tenant/bonuses/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .buffer(true)
        .parse((response, cb) => {
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (raw += chunk));
          response.on('end', () => cb(null, raw));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      assertCsvShape(res.body as string, 'granted_at,id,user_id');
      const after = await countAuditEntries('bonus.export');
      expect(after).toBeGreaterThanOrEqual(before + 1);
    });
  });

  describe('GET /tenant/deposits/export', () => {
    it('cajero sin permiso → 403', async () => {
      const res = await ctx.request
        .get('/tenant/deposits/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });

    it('admin → 200 CSV + audit entry deposits.export', async () => {
      const before = await countAuditEntries('deposits.export');
      const res = await ctx.request
        .get('/tenant/deposits/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .buffer(true)
        .parse((response, cb) => {
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (raw += chunk));
          response.on('end', () => cb(null, raw));
        });
      expect(res.status).toBe(200);
      assertCsvShape(res.body as string, 'created_at,id,status,user_id');
      const after = await countAuditEntries('deposits.export');
      expect(after).toBeGreaterThanOrEqual(before + 1);
    });
  });

  describe('GET /tenant/withdrawals/export', () => {
    it('cajero sin permiso → 403', async () => {
      const res = await ctx.request
        .get('/tenant/withdrawals/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });

    it('admin → 200 CSV + audit entry withdrawals.export', async () => {
      const before = await countAuditEntries('withdrawals.export');
      const res = await ctx.request
        .get('/tenant/withdrawals/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .buffer(true)
        .parse((response, cb) => {
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (raw += chunk));
          response.on('end', () => cb(null, raw));
        });
      expect(res.status).toBe(200);
      assertCsvShape(res.body as string, 'created_at,id,status,user_id');
      const after = await countAuditEntries('withdrawals.export');
      expect(after).toBeGreaterThanOrEqual(before + 1);
    });
  });

  describe('GET /tenant/users/export', () => {
    it('cajero sin permiso → 403', async () => {
      const res = await ctx.request
        .get('/tenant/users/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });

    it('admin → 200 CSV con header users + audit entry users.export', async () => {
      const before = await countAuditEntries('users.export');
      const res = await ctx.request
        .get('/tenant/users/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .buffer(true)
        .parse((response, cb) => {
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (raw += chunk));
          response.on('end', () => cb(null, raw));
        });
      expect(res.status).toBe(200);
      assertCsvShape(res.body as string, 'created_at,id,username,display_name');
      // Sin password_hash ni two_fa_secret en el CSV.
      expect(res.body as string).not.toContain('password_hash');
      expect(res.body as string).not.toContain('two_fa_secret');
      const after = await countAuditEntries('users.export');
      expect(after).toBeGreaterThanOrEqual(before + 1);
    });

    // Regresión (2026-08-14): el export ignoraba TODOS los filtros y hacía un
    // SELECT * crudo (además de saltarse el scope de jerarquía → fuga entre
    // redes). Ahora es espejo de list(). Este test prueba que el filtro viaja:
    // un search que no matchea a nadie debe devolver el CSV con solo el header.
    it('respeta el filtro search (no trae filas fuera del filtro)', async () => {
      const res = await ctx.request
        .get('/tenant/users/export')
        .query({ search: 'zzz_usuario_inexistente_9f3a_zzz' })
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .buffer(true)
        .parse((response, cb) => {
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (raw += chunk));
          response.on('end', () => cb(null, raw));
        });
      expect(res.status).toBe(200);
      const body = (res.body as string).slice(1); // sin BOM
      const lines = body.trim().split('\r\n');
      // Solo el header, sin ninguna fila de datos.
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain('username');
    });
  });

  describe('GET /tenant/promotions/export', () => {
    it('cajero sin permiso → 403', async () => {
      const res = await ctx.request
        .get('/tenant/promotions/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });

    it('admin → 200 CSV + audit entry promotion.export', async () => {
      const before = await countAuditEntries('promotion.export');
      const res = await ctx.request
        .get('/tenant/promotions/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .buffer(true)
        .parse((response, cb) => {
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (raw += chunk));
          response.on('end', () => cb(null, raw));
        });
      expect(res.status).toBe(200);
      assertCsvShape(res.body as string, 'created_at,id,code,name,type');
      const after = await countAuditEntries('promotion.export');
      expect(after).toBeGreaterThanOrEqual(before + 1);
    });
  });

  describe('GET /tenant/leagues/export', () => {
    it('cajero sin permiso → 403', async () => {
      const res = await ctx.request
        .get('/tenant/leagues/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });

    it('admin → 200 CSV + audit entry league.export', async () => {
      const before = await countAuditEntries('league.export');
      const res = await ctx.request
        .get('/tenant/leagues/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .buffer(true)
        .parse((response, cb) => {
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (raw += chunk));
          response.on('end', () => cb(null, raw));
        });
      expect(res.status).toBe(200);
      assertCsvShape(res.body as string, 'created_at,id,code,name,period,metric');
      const after = await countAuditEntries('league.export');
      expect(after).toBeGreaterThanOrEqual(before + 1);
    });
  });

  describe('GET /tenant/bonus-definitions/export', () => {
    it('cajero sin permiso → 403', async () => {
      const res = await ctx.request
        .get('/tenant/bonus-definitions/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });

    it('admin → 200 CSV + audit entry bonus.definition.export', async () => {
      const before = await countAuditEntries('bonus.definition.export');
      const res = await ctx.request
        .get('/tenant/bonus-definitions/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .buffer(true)
        .parse((response, cb) => {
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (raw += chunk));
          response.on('end', () => cb(null, raw));
        });
      expect(res.status).toBe(200);
      assertCsvShape(res.body as string, 'created_at,id,code,name,type');
      const after = await countAuditEntries('bonus.definition.export');
      expect(after).toBeGreaterThanOrEqual(before + 1);
    });
  });

  describe('GET /tenant/notifications/export', () => {
    it('cajero sin permiso → 403', async () => {
      const res = await ctx.request
        .get('/tenant/notifications/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });

    it('admin → 200 CSV + audit entry notifications.export', async () => {
      const before = await countAuditEntries('notifications.export');
      const res = await ctx.request
        .get('/tenant/notifications/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .buffer(true)
        .parse((response, cb) => {
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (raw += chunk));
          response.on('end', () => cb(null, raw));
        });
      expect(res.status).toBe(200);
      assertCsvShape(res.body as string, 'created_at,id,user_id,username');
      const after = await countAuditEntries('notifications.export');
      expect(after).toBeGreaterThanOrEqual(before + 1);
    });
  });

  describe('GET /tenant/wallet/me/transactions/export', () => {
    it('cajero sin permiso → 403 (no tiene wallet.export)', async () => {
      const res = await ctx.request
        .get('/tenant/wallet/me/transactions/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });

    it('admin → 200 CSV + audit entry wallet.export.me', async () => {
      const before = await countAuditEntries('wallet.export.me');
      const res = await ctx.request
        .get('/tenant/wallet/me/transactions/export')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .buffer(true)
        .parse((response, cb) => {
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (raw += chunk));
          response.on('end', () => cb(null, raw));
        });
      expect(res.status).toBe(200);
      assertCsvShape(res.body as string, 'created_at,id,wallet_id,type');
      const after = await countAuditEntries('wallet.export.me');
      expect(after).toBeGreaterThanOrEqual(before + 1);
    });
  });
});
