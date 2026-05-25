/**
 * Tests del provably fair.
 *
 * Lo crítico: el commitHash publicado tiene que matchear con el
 * serverSeed revelado, sino el cliente detecta que el servidor mintió.
 * Y el roundSeed tiene que ser reproducible a posteriori desde los
 * 3 inputs (serverSeed, clientSeed, nonce).
 */

import { describe, it, expect } from 'vitest';
import {
  newServerSeed,
  computeRoundSeed,
  verifyCommit,
  isValidClientSeed,
  newClientSeedDefault,
} from './provably-fair';

describe('provably-fair', () => {
  describe('newServerSeed', () => {
    it('genera un seed de 32 bytes y un commitHash de 64 hex chars', () => {
      const { seed, commitHash } = newServerSeed();
      expect(seed).toBeInstanceOf(Buffer);
      expect(seed.length).toBe(32);
      expect(commitHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('genera seeds distintos en runs sucesivas (no determinístico)', () => {
      const a = newServerSeed();
      const b = newServerSeed();
      expect(a.seed.equals(b.seed)).toBe(false);
      expect(a.commitHash).not.toBe(b.commitHash);
    });

    it('el commitHash es SHA256 del seed', () => {
      const { seed, commitHash } = newServerSeed();
      expect(verifyCommit(seed, commitHash)).toBe(true);
    });
  });

  describe('computeRoundSeed', () => {
    it('es determinístico — mismos inputs producen mismo output', () => {
      const server = Buffer.alloc(32, 'a');
      const a = computeRoundSeed(server, 'client123', 0);
      const b = computeRoundSeed(server, 'client123', 0);
      expect(a.equals(b)).toBe(true);
    });

    it('cambia con cualquier input distinto', () => {
      const server = Buffer.alloc(32, 'a');
      const base = computeRoundSeed(server, 'client123', 0);
      const diffServer = computeRoundSeed(Buffer.alloc(32, 'b'), 'client123', 0);
      const diffClient = computeRoundSeed(server, 'client456', 0);
      const diffNonce = computeRoundSeed(server, 'client123', 1);
      expect(diffServer.equals(base)).toBe(false);
      expect(diffClient.equals(base)).toBe(false);
      expect(diffNonce.equals(base)).toBe(false);
    });

    it('devuelve 32 bytes', () => {
      const seed = computeRoundSeed(Buffer.alloc(32), 'x', 0);
      expect(seed.length).toBe(32);
    });
  });

  describe('verifyCommit', () => {
    it('rechaza un commitHash que no se corresponde con el seed', () => {
      const { seed } = newServerSeed();
      const fakeHash = 'a'.repeat(64);
      expect(verifyCommit(seed, fakeHash)).toBe(false);
    });

    it('rechaza un commitHash de formato inválido', () => {
      const { seed } = newServerSeed();
      expect(verifyCommit(seed, 'short')).toBe(false);
    });
  });

  describe('isValidClientSeed', () => {
    it('acepta strings ASCII printable de 1-128 chars', () => {
      expect(isValidClientSeed('a')).toBe(true);
      expect(isValidClientSeed('mi-seed-2026')).toBe(true);
      expect(isValidClientSeed('A'.repeat(128))).toBe(true);
    });

    it('rechaza vacío y >128', () => {
      expect(isValidClientSeed('')).toBe(false);
      expect(isValidClientSeed('A'.repeat(129))).toBe(false);
    });

    it('rechaza caracteres de control', () => {
      expect(isValidClientSeed('a\x00b')).toBe(false);
      expect(isValidClientSeed('a\nb')).toBe(false);
    });

    it('rechaza non-ASCII (emojis, acentos)', () => {
      expect(isValidClientSeed('café')).toBe(false);
      expect(isValidClientSeed('🎰')).toBe(false);
    });
  });

  describe('newClientSeedDefault', () => {
    it('genera 16 hex chars', () => {
      const seed = newClientSeedDefault();
      expect(seed).toMatch(/^[0-9a-f]{16}$/);
    });

    it('es valid para isValidClientSeed', () => {
      expect(isValidClientSeed(newClientSeedDefault())).toBe(true);
    });
  });
});
