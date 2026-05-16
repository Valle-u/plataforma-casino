/**
 * E2E: antifraude (doc 15 §D).
 *
 * Cobertura:
 *
 * Scanners:
 *   - shared_ip: 2 users con misma IP en user_sessions → signal+link.
 *   - similar_email: 2 users con email "juan@x.com" + "juam@x.com" →
 *     signal+link.
 *   - score combinado: si ambos signals dispara, suma weights.
 *   - umbral suspected: score < 70 → no link en DB.
 *
 * Clusters:
 *   - 3 users A↔B y B↔C → cluster {A,B,C}.
 *   - Links separados sin transitividad → 2 clusters distintos.
 *
 * Confirm/dismiss:
 *   - confirm cambia status + reviewedBy/At.
 *   - dismiss preserva en re-scan (no se re-flagea).
 *   - confirm sobre link ya resolved → 409.
 *
 * Permisos:
 *   - fraud.view requerido para listar.
 *   - fraud.review requerido para confirm/dismiss.
 *   - fraud.run_scan requerido para POST scans/run.
 *
 * isUserFlagged helper:
 *   - user en link suspected score>=70 → true.
 *   - user en link dismissed → false.
 *   - user en link confirmed → true.
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Inserta una user_session sintética para que el scanner de IPs la vea.
 */
async function insertSession(userId: string, ip: string): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(
      `INSERT INTO user_sessions
        (id, user_id, token_hash, ip, expires_at)
       VALUES
        (gen_random_uuid(), $1, $2, $3, NOW() + INTERVAL '30 days')`,
      [userId, `synthetic-hash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ip],
    );
  } finally {
    await sql.end();
  }
}

/** Sobreescribe el email de un user via SQL (para tests). */
async function setEmail(userId: string, email: string): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(`UPDATE users SET email = $1 WHERE id = $2`, [email, userId]);
  } finally {
    await sql.end();
  }
}

async function deleteAllFraudData(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(`DELETE FROM fraud_account_links`);
    await sql.unsafe(`DELETE FROM fraud_signals`);
    await sql.unsafe(`DELETE FROM user_sessions WHERE token_hash LIKE 'synthetic-hash-%'`);
  } finally {
    await sql.end();
  }
}

async function readLinkBetween(
  userA: string,
  userB: string,
): Promise<Record<string, unknown> | null> {
  const [a, b] = userA < userB ? [userA, userB] : [userB, userA];
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT * FROM fraud_account_links
      WHERE user_a_id = ${a} AND user_b_id = ${b}
    `;
    return rows[0] ?? null;
  } finally {
    await sql.end();
  }
}

describe('Fraud detection (E2E)', () => {
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

  beforeEach(async () => {
    // Tests aislados: cada uno arranca con tablas fraud limpias y sin
    // sesiones sintéticas previas. NO reseteamos emails de users de
    // tests previos — el scan los va a procesar igual, pero cada test
    // verifica solo SU pair específico (assertions relativas), no
    // counts absolutos.
    await deleteAllFraudData();
  });

  /** Crea N users uniqe y devuelve sus ids. */
  async function createPlayers(n: number, suiteLabel: string): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const p = await createTestUser(ctx.request, adminToken, {
        suite: `fraud-${suiteLabel}-${i}`,
        label: 'p',
        role: 'usuario_final',
      });
      ids.push(p.id);
    }
    return ids;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Scanner: shared IP
  // ──────────────────────────────────────────────────────────────────────

  describe('Scanner: shared_ip', () => {
    it('2 users con misma IP → score 30 NO crea link (bajo threshold 70)', async () => {
      const [uA, uB] = await createPlayers(2, 'ip-only');
      await insertSession(uA, '203.0.113.42');
      await insertSession(uB, '203.0.113.42');

      const run = await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(run.status).toBe(200);

      // shared_ip = weight 30, bajo el threshold 70. NO link en DB para
      // este pair. (Tests previos pueden tener signals que entren al
      // count global; verificamos solo este pair.)
      expect(await readLinkBetween(uA!, uB!)).toBeNull();
    });

    it('3 users con misma IP → 0 links (todos los pares score 30)', async () => {
      const [uA, uB, uC] = await createPlayers(3, 'ip-three');
      await insertSession(uA!, '198.51.100.7');
      await insertSession(uB!, '198.51.100.7');
      await insertSession(uC!, '198.51.100.7');

      await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      // C(3,2) = 3 pares, todos con score 30 < 70 → 0 links nuevos
      // para este triplet.
      for (const [a, b] of [
        [uA, uB],
        [uA, uC],
        [uB, uC],
      ] as const) {
        expect(await readLinkBetween(a!, b!)).toBeNull();
      }
    });

    it('IPs distintas → este pair específico no se linkea', async () => {
      const [uA, uB] = await createPlayers(2, 'ip-distinct');
      await insertSession(uA!, '1.1.1.1');
      await insertSession(uB!, '2.2.2.2');

      await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      // No comparten IP, no comparten email distintivo → no link.
      expect(await readLinkBetween(uA!, uB!)).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scanner: similar email
  // ──────────────────────────────────────────────────────────────────────

  describe('Scanner: similar_email', () => {
    it('emails distancia 1 + mismo dominio → signal weight 40 (no llega al 70 solo)', async () => {
      const [uA, uB] = await createPlayers(2, 'em-near');
      await setEmail(uA!, 'juan@example.com');
      await setEmail(uB!, 'juam@example.com'); // distance 1

      const run = await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(run.body.signalsCreated).toBeGreaterThanOrEqual(2);
      // Solo similar_email = 40 < 70 → no link.
      expect(await readLinkBetween(uA!, uB!)).toBeNull();
    });

    it('distinto dominio NO matchea (similitud cross-domain ignorada)', async () => {
      const [uA, uB] = await createPlayers(2, 'em-domain');
      // Local parts IGUALES pero domain DISTINTO → el scanner agrupa
      // por dominio, entonces nunca compara estos dos entre sí.
      await setEmail(uA!, 'maria@example.com');
      await setEmail(uB!, 'maria@otherdomain.com');

      await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      // Este pair específico NO debe tener link.
      expect(await readLinkBetween(uA!, uB!)).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Score combinado → crea link
  // ──────────────────────────────────────────────────────────────────────

  describe('Score combinado', () => {
    it('shared_ip (30) + similar_email (40) = 70 → link suspected creado', async () => {
      const [uA, uB] = await createPlayers(2, 'combo');
      await setEmail(uA!, 'pedro@gmail.com');
      await setEmail(uB!, 'pedrox@gmail.com'); // distance 1
      await insertSession(uA!, '10.20.30.40');
      await insertSession(uB!, '10.20.30.40');

      const run = await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(run.status).toBe(200);
      expect(run.body.newSuspectedLinks).toBeGreaterThanOrEqual(1);

      const link = await readLinkBetween(uA!, uB!);
      expect(link).not.toBeNull();
      expect(Number(link!.score)).toBe(70);
      expect(link!.status).toBe('suspected');
    });

    it('link aparece en endpoint /links después del scan', async () => {
      const [uA, uB] = await createPlayers(2, 'flagged');
      await setEmail(uA!, 'ana@gmail.com');
      await setEmail(uB!, 'anax@gmail.com');
      await insertSession(uA!, '11.22.33.44');
      await insertSession(uB!, '11.22.33.44');

      await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const links = await ctx.request
        .get('/tenant/fraud/links')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(links.status).toBe(200);
      const data = links.body.data as Array<{ userAId: string; userBId: string; score: string }>;
      const myLink = data.find(
        (l) => (l.userAId === uA && l.userBId === uB) || (l.userAId === uB && l.userBId === uA),
      );
      expect(myLink).toBeDefined();
      expect(Number(myLink!.score)).toBeGreaterThanOrEqual(70);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Clusters (union-find)
  // ──────────────────────────────────────────────────────────────────────

  describe('Clusters', () => {
    it('A↔B y B↔C → cluster {A,B,C}', async () => {
      const [uA, uB, uC] = await createPlayers(3, 'cluster-trans');
      await setEmail(uA!, 'foo1@dom.com');
      await setEmail(uB!, 'foo2@dom.com');
      await setEmail(uC!, 'foo3@dom.com'); // distance 1 entre cada par
      const sharedIp = '5.6.7.8';
      await insertSession(uA!, sharedIp);
      await insertSession(uB!, sharedIp);
      await insertSession(uC!, sharedIp);

      await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const clusters = await ctx.request
        .get('/tenant/fraud/clusters')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(clusters.status).toBe(200);

      // Buscar el cluster que contiene a los 3 players.
      const myCluster = (clusters.body.data as Array<{ userIds: string[] }>).find(
        (c) => c.userIds.includes(uA!) && c.userIds.includes(uB!) && c.userIds.includes(uC!),
      );
      expect(myCluster).toBeDefined();
      expect(myCluster!.userIds).toHaveLength(3);
    });

    it('2 pares no conectados → 2 clusters separados', async () => {
      const [uA, uB, uC, uD] = await createPlayers(4, 'cluster-sep');
      // Pair AB
      await setEmail(uA!, 'alpha1@sep.com');
      await setEmail(uB!, 'alpha2@sep.com');
      await insertSession(uA!, '40.0.0.1');
      await insertSession(uB!, '40.0.0.1');
      // Pair CD — emails con local parts CON 4+ chars de diferencia
      // a los emails de uA/uB para que NO matcheen levenshtein <= 2.
      await setEmail(uC!, 'omega1@sep.com');
      await setEmail(uD!, 'omega2@sep.com');
      await insertSession(uC!, '50.0.0.1');
      await insertSession(uD!, '50.0.0.1');

      await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const clusters = await ctx.request
        .get('/tenant/fraud/clusters')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const allClusters = clusters.body.data as Array<{ userIds: string[] }>;
      const clusterAB = allClusters.find(
        (c) => c.userIds.includes(uA!) && c.userIds.includes(uB!),
      );
      const clusterCD = allClusters.find(
        (c) => c.userIds.includes(uC!) && c.userIds.includes(uD!),
      );
      expect(clusterAB).toBeDefined();
      expect(clusterCD).toBeDefined();
      // Los clusters deben ser DISTINTOS (no compartir users).
      expect(clusterAB!.userIds).not.toContain(uC);
      expect(clusterCD!.userIds).not.toContain(uA);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Confirm / dismiss
  // ──────────────────────────────────────────────────────────────────────

  describe('Confirm / dismiss', () => {
    async function createSuspectedLink(label: string): Promise<{ uA: string; uB: string; linkId: string }> {
      const [uA, uB] = await createPlayers(2, label);
      await setEmail(uA!, `cd1${label}@cd.com`);
      await setEmail(uB!, `cd2${label}@cd.com`);
      await insertSession(uA!, '9.9.9.9');
      await insertSession(uB!, '9.9.9.9');
      await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const link = await readLinkBetween(uA!, uB!);
      expect(link).not.toBeNull();
      return { uA: uA!, uB: uB!, linkId: link!.id as string };
    }

    it('confirm cambia status + persistencia de reviewedBy', async () => {
      const { linkId } = await createSuspectedLink('confirm');
      const res = await ctx.request
        .post(`/tenant/fraud/links/${linkId}/confirm`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('confirmed');
      expect(res.body.reviewedByUserId).toBeDefined();
    });

    it('dismiss preserva en re-scan (NO se re-flagea)', async () => {
      const { uA, uB, linkId } = await createSuspectedLink('dismiss');
      const r = await ctx.request
        .post(`/tenant/fraud/links/${linkId}/dismiss`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r.body.status).toBe('dismissed');

      // Re-run scan — el link debe quedar dismissed.
      await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const link = await readLinkBetween(uA, uB);
      expect(link!.status).toBe('dismissed');
    });

    it('GET /links?status=dismissed devuelve solo dismissed con username enriched', async () => {
      const { uA, uB, linkId } = await createSuspectedLink('list-dismissed');
      // Lookup usernames pre-fetch para comparar con lo enriquecido.
      const usernameRes = await ctx.request
        .get(`/tenant/users/${uA}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const expectedUsernameA = usernameRes.body.user.username as string;

      // Dismiss el link.
      await ctx.request
        .post(`/tenant/fraud/links/${linkId}/dismiss`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      // ?status=dismissed debe traerlo (aunque score esté por debajo del threshold).
      const dismissedRes = await ctx.request
        .get('/tenant/fraud/links?status=dismissed')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(dismissedRes.status).toBe(200);
      const data = dismissedRes.body.data as Array<{
        userAId: string;
        userBId: string;
        status: string;
        userAUsername: string | null;
        userBUsername: string | null;
      }>;
      const found = data.find((l) => l.userAId === uA && l.userBId === uB);
      expect(found).toBeDefined();
      expect(found!.status).toBe('dismissed');
      expect(typeof dismissedRes.body.total).toBe('number');
      // username enriquecido en el JOIN.
      expect([found!.userAUsername, found!.userBUsername]).toContain(
        expectedUsernameA,
      );

      // ?status=suspected NO debe traerlo (ya está dismissed).
      const suspectedRes = await ctx.request
        .get('/tenant/fraud/links?status=suspected')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const suspectedData = suspectedRes.body.data as Array<{ userAId: string; userBId: string }>;
      expect(
        suspectedData.find((l) => l.userAId === uA && l.userBId === uB),
      ).toBeUndefined();

      // ?status=invalido → 400.
      const badRes = await ctx.request
        .get('/tenant/fraud/links?status=invalido')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(badRes.status).toBe(400);
      expect(badRes.body.error).toBe('INVALID_FRAUD_STATUS');
    });

    it('confirm sobre link ya confirmed → 409', async () => {
      const { linkId } = await createSuspectedLink('double-confirm');
      await ctx.request
        .post(`/tenant/fraud/links/${linkId}/confirm`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const r2 = await ctx.request
        .post(`/tenant/fraud/links/${linkId}/confirm`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r2.status).toBe(409);
      expect(r2.body).toMatchObject({ error: 'FRAUD_LINK_ALREADY_RESOLVED' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Permisos
  // ──────────────────────────────────────────────────────────────────────

  describe('Permisos', () => {
    it('cajero1 sin fraud.view → 403 en GET /links', async () => {
      const res = await ctx.request
        .get('/tenant/fraud/links')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });

    it('cajero1 sin fraud.run_scan → 403 en POST /scans/run', async () => {
      const res = await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // isUserFlagged helper (vía service directo)
  // ──────────────────────────────────────────────────────────────────────

  describe('Estado por user (semantica isUserFlagged)', () => {
    it('user en link suspected aparece en links activos; user sin link no', async () => {
      const [uA, uB, uC] = await createPlayers(3, 'flagged');
      // Pair AB: forma link suspected.
      await setEmail(uA!, 'fl1@fl.com');
      await setEmail(uB!, 'fl2@fl.com');
      await insertSession(uA!, '77.77.77.77');
      await insertSession(uB!, '77.77.77.77');
      // uC: solo — sin signals, sin link.

      await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      // Verificamos el state desde el endpoint público /links — es la
      // misma fuente que `isUserFlagged` consulta internamente.
      const links = await ctx.request
        .get('/tenant/fraud/links')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const data = links.body.data as Array<{
        userAId: string;
        userBId: string;
        status: string;
      }>;

      const aOrB = data.find(
        (l) =>
          (l.userAId === uA && l.userBId === uB) ||
          (l.userAId === uB && l.userBId === uA),
      );
      expect(aOrB).toBeDefined();
      expect(aOrB!.status).toBe('suspected');

      // uC NO aparece en ningún link.
      const cInAny = data.find((l) => l.userAId === uC || l.userBId === uC);
      expect(cInAny).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Stats endpoint
  // ──────────────────────────────────────────────────────────────────────

  describe('stats', () => {
    it('devuelve counts por status', async () => {
      const [uA, uB] = await createPlayers(2, 'stats');
      await setEmail(uA!, 'st1@st.com');
      await setEmail(uB!, 'st2@st.com');
      await insertSession(uA!, '88.88.88.88');
      await insertSession(uB!, '88.88.88.88');

      await ctx.request
        .post('/tenant/fraud/scans/run')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const stats = await ctx.request
        .get('/tenant/fraud/stats')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(stats.status).toBe(200);
      expect(stats.body).toMatchObject({
        totalSignals: expect.any(Number) as number,
        suspectedLinks: expect.any(Number) as number,
        confirmedLinks: expect.any(Number) as number,
        dismissedLinks: expect.any(Number) as number,
      });
      expect(stats.body.suspectedLinks).toBeGreaterThanOrEqual(1);
    });
  });
});
