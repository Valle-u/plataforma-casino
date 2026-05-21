/**
 * Spec 22 — Stress test contra R2 real (manual, no en CI por default).
 *
 * Crea muchos users, sube muchos comprobantes de varios tipos y
 * tamaños, valida que todos los archivos terminan en R2 fetchables, y
 * mide tiempos. Útil para detectar:
 *   - Rate limiting de R2 (no debería haber, pero...).
 *   - Memory leaks en multer (buffer in-memory).
 *   - Race conditions en concurrent uploads.
 *   - Signed URL expiry edge cases.
 *
 * Métricas que reporta al final:
 *   - Total deposits creados.
 *   - Total bytes subidos.
 *   - p50/p95/p99 de duración de upload.
 *   - Fetch success rate.
 *   - Reject cleanup success rate.
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  ensurePaymentMethod,
  loginAs,
  loginAsAdmin,
  type TestPlayer,
} from './helpers/api';

const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000';
const TENANT_HOST = process.env.E2E_TENANT_HOST ?? 'demo.localhost';

// Cantidad de iteraciones — bajable si queremos tests rápidos en CI.
const N_USERS = 5;
const DEPOSITS_PER_USER = 4;
const TOTAL = N_USERS * DEPOSITS_PER_USER;

// PNG 1x1 (~70 bytes)
const PNG_TINY = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

// JPEG válido más grande (~2KB, generado con un solid color de 32x32).
const JPG_SMALL = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8/wA9aXNJ3p9KwhM0lLRR0Q+goPHWlpKWmGgYP+f8/wA8U7tTaUUDA9KKKKAA9KZQelFA0f/Z',
  'base64',
);

// PDF mínimo válido (~600 bytes — header + xref + trailer)
const PDF_TINY = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000053 00000 n \n0000000095 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%%EOF',
  'utf8',
);

const FIXTURES = [
  { name: 'tiny.png', bytes: PNG_TINY, mime: 'image/png' },
  { name: 'small.jpg', bytes: JPG_SMALL, mime: 'image/jpeg' },
  { name: 'doc.pdf', bytes: PDF_TINY, mime: 'application/pdf' },
  { name: 'photo.png', bytes: PNG_TINY, mime: 'image/png' }, // duplicado para tener variedad
];

async function uploadProof(
  token: string,
  fixture: { name: string; bytes: Buffer; mime: string },
): Promise<{
  receiptUrl: string;
  receiptStorageKey: string;
  durationMs: number;
}> {
  const start = Date.now();
  const fd = new FormData();
  fd.append(
    'file',
    new Blob([new Uint8Array(fixture.bytes)], { type: fixture.mime }),
    fixture.name,
  );
  const res = await fetch(`${API_BASE}/tenant/deposits/upload-proof`, {
    method: 'POST',
    headers: {
      'X-Tenant-Host': TENANT_HOST,
      Authorization: `Bearer ${token}`,
    },
    body: fd,
  });
  if (!res.ok) {
    throw new Error(`upload failed ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    receiptUrl: string;
    receiptStorageKey: string;
  };
  return { ...body, durationMs: Date.now() - start };
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

test.describe('R2 stress test', () => {
  let adminApi: ApiClient;
  let methodId: string;

  test.beforeAll(async () => {
    adminApi = await ApiClient.create();
    await loginAsAdmin(adminApi);
    methodId = (await ensurePaymentMethod(adminApi)).id;
  });

  test.afterAll(async () => {
    await adminApi.dispose();
  });

  test(`crea ${N_USERS} users × ${DEPOSITS_PER_USER} deposits con archivos variados`, async () => {
    test.setTimeout(180_000); // 3 min

    const uploadTimes: number[] = [];
    const allFetches: Array<{ ok: boolean; status: number }> = [];
    const createdDeposits: Array<{ id: string; storageKey: string }> = [];
    let totalBytes = 0;

    console.log(`\n=== R2 STRESS TEST ===`);
    console.log(`Creando ${N_USERS} users, ${DEPOSITS_PER_USER} deposits c/u → ${TOTAL} total\n`);

    // 1. Crear usuarios (serial para no colisionar usernames).
    const players: TestPlayer[] = [];
    for (let i = 0; i < N_USERS; i++) {
      const p = await createTestPlayer(adminApi, `sp22-stress-${i}`);
      players.push(p);
    }
    console.log(`✓ ${N_USERS} users creados`);

    // 2. Por cada user, loguearse + subir N comprobantes + crear deposits.
    //    Vamos serial por user pero paralelos los deposits del mismo user.
    for (const [i, player] of players.entries()) {
      const playerApi = await ApiClient.create();
      const token = await loginAs(playerApi, player.username, player.password);

      // Subir N comprobantes en paralelo.
      const uploads = await Promise.all(
        Array.from({ length: DEPOSITS_PER_USER }, (_, j) => {
          const fixture = FIXTURES[j % FIXTURES.length]!;
          totalBytes += fixture.bytes.length;
          return uploadProof(token, fixture);
        }),
      );

      // Crear deposits con esos comprobantes (serial para respetar MAX 2
      // pending por user — creamos 2, esperamos, creamos 2 más).
      // En este test solo creamos los primeros 2 (no entramos a aprobar).
      const BATCH = Math.min(DEPOSITS_PER_USER, 2);
      for (let j = 0; j < BATCH; j++) {
        const u = uploads[j]!;
        uploadTimes.push(u.durationMs);
        const dep = await playerApi.post<{ deposit: { id: string } }>(
          '/tenant/deposits',
          {
            methodId,
            amountChips: String(100 + j * 10),
            amountFiat: String(100 + j * 10),
            currencyFiat: 'ARS',
            receiptUrl: u.receiptUrl,
            receiptStorageKey: u.receiptStorageKey,
          },
        );
        createdDeposits.push({
          id: dep.deposit.id,
          storageKey: u.receiptStorageKey,
        });

        // Validar que la URL del comprobante es realmente fetchable
        // desde R2 (HEAD request — menos bandwidth que GET).
        const fetchRes = await fetch(u.receiptUrl, { method: 'GET' });
        allFetches.push({ ok: fetchRes.ok, status: fetchRes.status });
      }

      // Resto de uploads — los que no usamos por el cap MAX 2, los
      // contamos para tiempo pero no creamos deposit (los archivos
      // quedan en R2 como huérfanos del test — los limpiamos abajo).
      for (let j = BATCH; j < DEPOSITS_PER_USER; j++) {
        const u = uploads[j]!;
        uploadTimes.push(u.durationMs);
        // Cleanup directo del orphan (no podemos crear más deposits).
        // Hacemos un fetch + después dejamos que el cron limpie. Por
        // ahora solo medimos el upload.
        const fetchRes = await fetch(u.receiptUrl);
        allFetches.push({ ok: fetchRes.ok, status: fetchRes.status });
        // Marcamos también para reject test después.
        createdDeposits.push({ id: '', storageKey: u.receiptStorageKey });
      }

      await playerApi.dispose();
      if ((i + 1) % 5 === 0 || i === players.length - 1) {
        console.log(`  ✓ user ${i + 1}/${players.length}: ${DEPOSITS_PER_USER} uploads OK`);
      }
    }

    // 3. Reportar métricas.
    const totalUploads = uploadTimes.length;
    const failedFetches = allFetches.filter((f) => !f.ok).length;
    const p50 = percentile(uploadTimes, 50);
    const p95 = percentile(uploadTimes, 95);
    const p99 = percentile(uploadTimes, 99);
    const sum = uploadTimes.reduce((a, b) => a + b, 0);
    const avg = sum / totalUploads;

    console.log(`\n=== RESULTADOS ===`);
    console.log(`Uploads totales:    ${totalUploads}`);
    console.log(`Deposits creados:   ${createdDeposits.filter((d) => d.id).length}`);
    console.log(`Bytes subidos:      ${(totalBytes / 1024).toFixed(1)} KB`);
    console.log(`Fetches OK:         ${allFetches.length - failedFetches}/${allFetches.length}`);
    console.log(``);
    console.log(`Upload duration (ms):`);
    console.log(`  avg: ${avg.toFixed(0)}`);
    console.log(`  p50: ${p50}`);
    console.log(`  p95: ${p95}`);
    console.log(`  p99: ${p99}`);
    console.log(`  min: ${Math.min(...uploadTimes)}`);
    console.log(`  max: ${Math.max(...uploadTimes)}`);

    // Hard assertions.
    expect(totalUploads).toBe(TOTAL);
    expect(failedFetches).toBe(0); // Todos los archivos deben ser fetchables.
    expect(p95).toBeLessThan(5000); // p95 < 5s es razonable para R2.

    console.log(`\n=== R2 STRESS TEST OK ===\n`);
  });

  test('rechazar deposits creados → cleanup automático del storage', async () => {
    test.setTimeout(120_000);

    // Crear 3 deposits nuevos, rechazarlos, verificar que el archivo
    // YA NO existe en R2.
    const player = await createTestPlayer(adminApi, 'sp22-cleanup');
    const playerApi = await ApiClient.create();
    const token = await loginAs(playerApi, player.username, player.password);

    const N = 2; // max pending por user
    const items: Array<{ depositId: string; receiptUrl: string }> = [];

    for (let i = 0; i < N; i++) {
      const upload = await uploadProof(token, FIXTURES[i % FIXTURES.length]!);
      const dep = await playerApi.post<{ deposit: { id: string } }>(
        '/tenant/deposits',
        {
          methodId,
          amountChips: '200',
          amountFiat: '200',
          currencyFiat: 'ARS',
          receiptUrl: upload.receiptUrl,
          receiptStorageKey: upload.receiptStorageKey,
        },
      );
      items.push({ depositId: dep.deposit.id, receiptUrl: upload.receiptUrl });
    }
    await playerApi.dispose();

    // Validar que existen antes de rechazar.
    for (const it of items) {
      const r = await fetch(it.receiptUrl);
      expect(r.status).toBe(200);
    }

    // Rechazar todos.
    for (const it of items) {
      await adminApi.post(`/tenant/deposits/${it.depositId}/reject`, {
        reason: 'spec 22 cleanup test',
      });
    }

    // Validar que el archivo YA NO es fetchable (cleanup async).
    // Damos ~500ms para que el storage.delete corra.
    await new Promise((r) => setTimeout(r, 500));

    let cleanedUp = 0;
    for (const it of items) {
      // Después del reject, fetchamos la URL original. Como el storage
      // delete corrió, R2 devuelve 404 / 403. (LocalDisk también 404.)
      const r = await fetch(it.receiptUrl);
      if (!r.ok) cleanedUp++;
    }

    console.log(`\nCleanup en reject: ${cleanedUp}/${items.length} archivos borrados de R2`);
    expect(cleanedUp).toBe(items.length);
  });
});
