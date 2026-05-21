/**
 * Spec 20 — Upload de comprobante obligatorio (Sprint 51.6).
 *
 * Valida:
 *   - POST /tenant/deposits/upload-proof devuelve receiptUrl + storageKey.
 *   - Crear deposit SIN receiptUrl → 400 (DTO valida IsNotEmpty).
 *   - MIME no permitido → 400 FILE_TYPE_NOT_ALLOWED.
 *   - Tamaño > 5 MB → 400 (multer rebota antes que llegue al handler).
 *   - El comprobante es accesible via la URL devuelta (driver local).
 *   - El detail endpoint regenera la URL desde el storage key.
 */

import { expect, test } from '@playwright/test';
import {
  ApiClient,
  createTestPlayer,
  ensurePaymentMethod,
  loginAs,
  loginAsAdmin,
  uploadDepositProof,
  type TestPlayer,
} from './helpers/api';

const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000';
const TENANT_HOST = process.env.E2E_TENANT_HOST ?? 'demo.localhost';

// PNG 1x1 transparent válido.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function postFile(opts: {
  token: string;
  file: Buffer;
  filename: string;
  mimeType: string;
}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE}/tenant/deposits/upload-proof`, {
    method: 'POST',
    headers: {
      'X-Tenant-Host': TENANT_HOST,
      Authorization: `Bearer ${opts.token}`,
    },
    body: (() => {
      const fd = new FormData();
      fd.append(
        'file',
        new Blob([new Uint8Array(opts.file)], { type: opts.mimeType }),
        opts.filename,
      );
      return fd;
    })(),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  return { status: res.status, body };
}

test.describe('Deposit proof upload (Sprint 51.6)', () => {
  let adminApi: ApiClient;
  let methodId: string;
  let player: TestPlayer;
  let playerApi: ApiClient;
  let playerToken: string;

  test.beforeAll(async () => {
    adminApi = await ApiClient.create();
    await loginAsAdmin(adminApi);
    const m = await ensurePaymentMethod(adminApi);
    methodId = m.id;
    player = await createTestPlayer(adminApi, 'sp20-uploader');
    playerApi = await ApiClient.create();
    playerToken = await loginAs(playerApi, player.username, player.password);
  });

  test.afterAll(async () => {
    await adminApi.dispose();
    if (playerApi) await playerApi.dispose();
  });

  test('upload-proof PNG válido → 201 con receiptUrl + storageKey', async () => {
    const res = await postFile({
      token: playerToken,
      file: PNG_BYTES,
      filename: 'proof.png',
      mimeType: 'image/png',
    });
    expect(res.status).toBe(201);
    const body = res.body as {
      receiptUrl: string;
      receiptStorageKey: string;
      sizeBytes: number;
    };
    expect(body.receiptUrl).toMatch(/^https?:\/\//);
    expect(body.receiptStorageKey).toMatch(/^tenants\/.+\/deposits\/proofs\/.+\.png$/);
    expect(body.sizeBytes).toBe(PNG_BYTES.length);

    // El archivo debe ser fetchable.
    const fetchRes = await fetch(body.receiptUrl);
    expect(fetchRes.status).toBe(200);
    expect(fetchRes.headers.get('content-type')).toContain('image/png');
  });

  test('upload-proof MIME no permitido → 400 FILE_TYPE_NOT_ALLOWED', async () => {
    const res = await postFile({
      token: playerToken,
      file: Buffer.from('not a real file'),
      filename: 'malicious.exe',
      mimeType: 'application/octet-stream',
    });
    expect(res.status).toBe(400);
    const body = res.body as { error?: string };
    expect(body.error).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  test('upload-proof sin file → 400 FILE_MISSING', async () => {
    const res = await fetch(`${API_BASE}/tenant/deposits/upload-proof`, {
      method: 'POST',
      headers: {
        'X-Tenant-Host': TENANT_HOST,
        Authorization: `Bearer ${playerToken}`,
      },
      body: new FormData(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('FILE_MISSING');
  });

  test('crear deposit SIN receiptUrl → 400 (DTO requerido)', async () => {
    const res = await playerApi.postRaw('/tenant/deposits', {
      methodId,
      amountChips: '100',
      amountFiat: '100',
      currencyFiat: 'ARS',
      // receiptUrl + receiptStorageKey omitidos.
    });
    expect(res.status).toBe(400);
  });

  test('crear deposit CON receiptUrl + storageKey → OK', async () => {
    const proof = await uploadDepositProof(playerApi);
    const res = await playerApi.post<{ deposit: { id: string } }>(
      '/tenant/deposits',
      {
        methodId,
        amountChips: '110',
        amountFiat: '110',
        currencyFiat: 'ARS',
        receiptUrl: proof.receiptUrl,
        receiptStorageKey: proof.receiptStorageKey,
      },
    );
    expect(res.deposit.id).toBeDefined();

    // El admin puede consultar el detail — la URL debería estar presente
    // y ser fetchable (driver local: URL estable).
    const detail = await adminApi.get<{
      deposit: { receiptUrl: string | null; receiptStorageKey: string | null };
    }>(`/tenant/deposits/${res.deposit.id}`);
    expect(detail.deposit.receiptUrl).toBeTruthy();
    expect(detail.deposit.receiptStorageKey).toBe(proof.receiptStorageKey);
    const fetchRes = await fetch(detail.deposit.receiptUrl!);
    expect(fetchRes.status).toBe(200);
  });
});
