/**
 * Tests unitarios del GregmornSigner (HMAC-SHA256 hex sobre el body crudo).
 *
 * Espeja `forever-signer.spec.ts`. Lo que se prueba, además del roundtrip:
 * que la firma sea sobre los BYTES del body (no sobre el JSON re-serializado),
 * que la lectura del header sea case-insensitive, y todos los modos de fallo.
 */

import { createHmac } from 'node:crypto';
import {
  GREGMORN_SIG_HEADER,
  signGregmornBody,
  signGregmornRequest,
  verifyGregmornCallback,
} from './gregmorn-signer';

const SECRET = 'sk_stage_9f2b7c41a8e04d6cb3157ae0d2f89b6c';
const BODY = JSON.stringify({
  cmd: 'writeBet',
  bet: 100,
  win: 0,
  login: 'player_1',
  sessionid: '7d3b9e2a-4f1c-8d06-a912-c3e5f7b29041',
  transactionId: 'tx_0001',
  round_finished: true,
  info: '{}',
});

/** Headers como los entrega NestJS: claves lowercase. */
function inbound(signature: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-signature': signature };
}

describe('GregmornSigner', () => {
  describe('signGregmornBody', () => {
    it('es HMAC-SHA256 hex del body con la secret_api_key', () => {
      const expected = createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex');
      expect(signGregmornBody(BODY, SECRET)).toBe(expected);
    });

    it('devuelve 64 chars hex en minúscula', () => {
      expect(signGregmornBody(BODY, SECRET)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('es determinístico: mismo body + misma clave → misma firma', () => {
      expect(signGregmornBody(BODY, SECRET)).toBe(signGregmornBody(BODY, SECRET));
    });

    it('un solo byte distinto en el body cambia la firma', () => {
      const otro = BODY.replace('"bet":100', '"bet":101');
      expect(signGregmornBody(otro, SECRET)).not.toBe(signGregmornBody(BODY, SECRET));
    });

    it('otra clave → otra firma', () => {
      expect(signGregmornBody(BODY, 'otra-clave')).not.toBe(signGregmornBody(BODY, SECRET));
    });

    it('firma los BYTES: re-serializar el JSON cambia la firma', () => {
      // Mismo objeto, distinto orden de claves = distintos bytes. Este es el
      // error clásico: parsear y volver a serializar antes de firmar.
      const reserializado = JSON.stringify(JSON.parse(BODY), Object.keys(JSON.parse(BODY)).reverse());
      expect(reserializado).not.toBe(BODY);
      expect(signGregmornBody(reserializado, SECRET)).not.toBe(signGregmornBody(BODY, SECRET));
    });

    it('body vacío no explota', () => {
      expect(signGregmornBody('', SECRET)).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('signGregmornRequest', () => {
    it('devuelve el header X-Signature con la firma del body', () => {
      const res = signGregmornRequest({ body: BODY, secretApiKey: SECRET });
      expect(res.headers[GREGMORN_SIG_HEADER]).toBe(res.signature);
      expect(res.signature).toBe(signGregmornBody(BODY, SECRET));
    });
  });

  describe('verifyGregmornCallback', () => {
    it('roundtrip: lo que firmamos verifica', () => {
      const { signature } = signGregmornRequest({ body: BODY, secretApiKey: SECRET });
      expect(
        verifyGregmornCallback({ body: BODY, secretApiKey: SECRET, headers: inbound(signature) }),
      ).toEqual({ verified: true, error: '' });
    });

    it('lee el header case-insensitive', () => {
      const signature = signGregmornBody(BODY, SECRET);
      for (const key of ['X-Signature', 'x-signature', 'X-SIGNATURE']) {
        const res = verifyGregmornCallback({
          body: BODY,
          secretApiKey: SECRET,
          headers: { [key]: signature },
        });
        expect(res.verified).toBe(true);
      }
    });

    it('acepta la firma en mayúsculas', () => {
      const signature = signGregmornBody(BODY, SECRET).toUpperCase();
      const res = verifyGregmornCallback({ body: BODY, secretApiKey: SECRET, headers: inbound(signature) });
      expect(res.verified).toBe(true);
    });

    it('tolera espacios alrededor de la firma', () => {
      const signature = `  ${signGregmornBody(BODY, SECRET)}  `;
      const res = verifyGregmornCallback({ body: BODY, secretApiKey: SECRET, headers: inbound(signature) });
      expect(res.verified).toBe(true);
    });

    it('toma el primer valor si el header llega repetido (array)', () => {
      const signature = signGregmornBody(BODY, SECRET);
      const res = verifyGregmornCallback({
        body: BODY,
        secretApiKey: SECRET,
        headers: { 'x-signature': [signature, 'basura'] },
      });
      expect(res.verified).toBe(true);
    });

    it('sin header → "No signature header"', () => {
      const res = verifyGregmornCallback({
        body: BODY,
        secretApiKey: SECRET,
        headers: { 'content-type': 'application/json' },
      });
      expect(res).toEqual({ verified: false, error: 'No signature header' });
    });

    it('header vacío → "No signature header"', () => {
      const res = verifyGregmornCallback({ body: BODY, secretApiKey: SECRET, headers: inbound('   ') });
      expect(res).toEqual({ verified: false, error: 'No signature header' });
    });

    it('sin secret_api_key configurada → "Missing secret_api_key" (nunca verified)', () => {
      const res = verifyGregmornCallback({
        body: BODY,
        secretApiKey: '',
        headers: inbound(signGregmornBody(BODY, SECRET)),
      });
      expect(res).toEqual({ verified: false, error: 'Missing secret_api_key' });
    });

    it('firma hecha con OTRA clave → "Invalid signature"', () => {
      const res = verifyGregmornCallback({
        body: BODY,
        secretApiKey: SECRET,
        headers: inbound(signGregmornBody(BODY, 'clave-del-atacante')),
      });
      expect(res).toEqual({ verified: false, error: 'Invalid signature' });
    });

    it('body manipulado después de firmar → "Invalid signature"', () => {
      const signature = signGregmornBody(BODY, SECRET);
      const manipulado = BODY.replace('"bet":100', '"bet":1');
      const res = verifyGregmornCallback({
        body: manipulado,
        secretApiKey: SECRET,
        headers: inbound(signature),
      });
      expect(res).toEqual({ verified: false, error: 'Invalid signature' });
    });

    it('firma con largo distinto → "Invalid signature" (no rompe timingSafeEqual)', () => {
      const res = verifyGregmornCallback({
        body: BODY,
        secretApiKey: SECRET,
        headers: inbound('abc123'),
      });
      expect(res).toEqual({ verified: false, error: 'Invalid signature' });
    });
  });
});
