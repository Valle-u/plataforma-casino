/**
 * Tests unitarios del ForeverSigner (firma Ed25519 + verificación de callback).
 *
 * Genera un par Ed25519 fresco, extrae las claves crudas de 32 bytes (como las
 * entrega el panel de Forever, en base64) y prueba el roundtrip firmar→verificar
 * + todos los modos de fallo de la verificación.
 */

import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  FOREVER_SIG_ALG,
  FOREVER_SIG_HEADERS,
  signForeverRequest,
  verifyForeverCallback,
} from './forever-signer';

/** Par Ed25519 → claves crudas de 32 bytes en base64 (formato del panel). */
function freshKeyPairBase64(): { privateKeyBase64: string; publicKeyBase64: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    privateKeyBase64: Buffer.from(pkcs8.subarray(pkcs8.length - 32)).toString('base64'),
    publicKeyBase64: Buffer.from(spki.subarray(spki.length - 32)).toString('base64'),
  };
}

/** Simula los headers como los entrega NestJS (lowercase) desde un sign result. */
function asInboundHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

describe('ForeverSigner', () => {
  const agentCode = 'redgardel';
  const body = JSON.stringify({ method: 'GetBalance', userCode: 'Player1' });
  const TS = 1_700_000_000_000;
  const NONCE = 'a'.repeat(32);

  describe('signForeverRequest', () => {
    it('produce los 6 headers X-Forever-Sig-* con los valores esperados', () => {
      const { privateKeyBase64 } = freshKeyPairBase64();
      const res = signForeverRequest({
        agentCode,
        privateKeyBase64,
        body,
        timestampMs: TS,
        nonce: NONCE,
      });

      expect(res.headers[FOREVER_SIG_HEADERS.ALG]).toBe(FOREVER_SIG_ALG);
      expect(res.headers[FOREVER_SIG_HEADERS.AGENT]).toBe(agentCode);
      expect(res.headers[FOREVER_SIG_HEADERS.TIMESTAMP]).toBe(String(TS));
      expect(res.headers[FOREVER_SIG_HEADERS.NONCE]).toBe(NONCE);
      expect(res.headers[FOREVER_SIG_HEADERS.BODY_HASH]).toBe(res.bodyHash);
      expect(res.headers[FOREVER_SIG_HEADERS.VALUE]).toBe(res.signature);
    });

    it('bodyHash = sha256 hex del body crudo', () => {
      const { privateKeyBase64 } = freshKeyPairBase64();
      const res = signForeverRequest({ agentCode, privateKeyBase64, body, timestampMs: TS, nonce: NONCE });
      const expected = createHash('sha256').update(body, 'utf8').digest('hex');
      expect(res.bodyHash).toBe(expected);
    });

    it('canonical = v1\\n<agent>\\n<ts>\\n<nonce>\\n<bodyHash>', () => {
      const { privateKeyBase64 } = freshKeyPairBase64();
      const res = signForeverRequest({ agentCode, privateKeyBase64, body, timestampMs: TS, nonce: NONCE });
      expect(res.canonical).toBe(['v1', agentCode, String(TS), NONCE, res.bodyHash].join('\n'));
    });

    it('firma base64url sin padding (sin +, /, =)', () => {
      const { privateKeyBase64 } = freshKeyPairBase64();
      const res = signForeverRequest({ agentCode, privateKeyBase64, body, timestampMs: TS, nonce: NONCE });
      expect(res.signature).not.toMatch(/[+/=]/);
    });

    it('genera un nonce aleatorio si no se pasa', () => {
      const { privateKeyBase64 } = freshKeyPairBase64();
      const a = signForeverRequest({ agentCode, privateKeyBase64, body });
      const b = signForeverRequest({ agentCode, privateKeyBase64, body });
      expect(a.nonce).toHaveLength(32);
      expect(a.nonce).not.toBe(b.nonce);
    });

    it('rechaza una clave privada que no sea de 32 bytes', () => {
      expect(() =>
        signForeverRequest({ agentCode, privateKeyBase64: Buffer.from('corta').toString('base64'), body }),
      ).toThrow(/32 bytes/);
    });
  });

  describe('verifyForeverCallback', () => {
    it('roundtrip: una firma válida verifica OK', () => {
      const { privateKeyBase64, publicKeyBase64 } = freshKeyPairBase64();
      const signed = signForeverRequest({ agentCode, privateKeyBase64, body, timestampMs: TS, nonce: NONCE });
      const res = verifyForeverCallback({
        publicKeyBase64,
        agentCode,
        body,
        headers: asInboundHeaders(signed.headers),
        nowMs: TS + 1000,
      });
      expect(res).toEqual({ verified: true, error: '' });
    });

    it('sin header de firma → "No signature headers"', () => {
      const { publicKeyBase64 } = freshKeyPairBase64();
      const res = verifyForeverCallback({ publicKeyBase64, agentCode, body, headers: {}, nowMs: TS });
      expect(res.verified).toBe(false);
      expect(res.error).toBe('No signature headers');
    });

    it('body alterado → "Body hash mismatch"', () => {
      const { privateKeyBase64, publicKeyBase64 } = freshKeyPairBase64();
      const signed = signForeverRequest({ agentCode, privateKeyBase64, body, timestampMs: TS, nonce: NONCE });
      const res = verifyForeverCallback({
        publicKeyBase64,
        agentCode,
        body: body + ' ',
        headers: asInboundHeaders(signed.headers),
        nowMs: TS + 1000,
      });
      expect(res.error).toBe('Body hash mismatch');
    });

    it('timestamp fuera de la ventana (±5 min) → "Signature expired"', () => {
      const { privateKeyBase64, publicKeyBase64 } = freshKeyPairBase64();
      const signed = signForeverRequest({ agentCode, privateKeyBase64, body, timestampMs: TS, nonce: NONCE });
      const res = verifyForeverCallback({
        publicKeyBase64,
        agentCode,
        body,
        headers: asInboundHeaders(signed.headers),
        nowMs: TS + 6 * 60 * 1000, // 6 min después
      });
      expect(res.error).toBe('Signature expired');
    });

    it('agentCode que no matchea → "Signature agent mismatch"', () => {
      const { privateKeyBase64, publicKeyBase64 } = freshKeyPairBase64();
      const signed = signForeverRequest({ agentCode, privateKeyBase64, body, timestampMs: TS, nonce: NONCE });
      const res = verifyForeverCallback({
        publicKeyBase64,
        agentCode: 'otro_agente',
        body,
        headers: asInboundHeaders(signed.headers),
        nowMs: TS + 1000,
      });
      expect(res.error).toBe('Signature agent mismatch');
    });

    it('firma hecha con OTRA clave → "Invalid signature"', () => {
      const a = freshKeyPairBase64();
      const b = freshKeyPairBase64();
      const signed = signForeverRequest({ agentCode, privateKeyBase64: a.privateKeyBase64, body, timestampMs: TS, nonce: NONCE });
      const res = verifyForeverCallback({
        publicKeyBase64: b.publicKeyBase64, // clave pública equivocada
        agentCode,
        body,
        headers: asInboundHeaders(signed.headers),
        nowMs: TS + 1000,
      });
      expect(res).toEqual({ verified: false, error: 'Invalid signature' });
    });

    it('alg distinto de Ed25519 → "Invalid signature algorithm"', () => {
      const { privateKeyBase64, publicKeyBase64 } = freshKeyPairBase64();
      const signed = signForeverRequest({ agentCode, privateKeyBase64, body, timestampMs: TS, nonce: NONCE });
      const headers = asInboundHeaders(signed.headers);
      headers[FOREVER_SIG_HEADERS.ALG.toLowerCase()] = 'HS256';
      const res = verifyForeverCallback({ publicKeyBase64, agentCode, body, headers, nowMs: TS + 1000 });
      expect(res.error).toBe('Invalid signature algorithm');
    });
  });
});
