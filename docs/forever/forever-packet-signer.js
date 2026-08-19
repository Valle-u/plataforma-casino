/**
 * Forever API packet signature helper (Node.js 18+)
 * npm install @noble/ed25519
 */
const crypto = require('crypto');
const ed25519 = require('@noble/ed25519');

const SIG = {
    ALG: 'X-Forever-Sig-Alg',
    AGENT: 'X-Forever-Sig-Agent',
    TIMESTAMP: 'X-Forever-Sig-Timestamp',
    NONCE: 'X-Forever-Sig-Nonce',
    BODY_HASH: 'X-Forever-Sig-BodyHash',
    VALUE: 'X-Forever-Sig-Value',
};
const ALGORITHM = 'Ed25519';
const CANONICAL_VERSION = 'v1';

function sha256Hex(text) {
    return crypto.createHash('sha256').update(text ?? '', 'utf8').digest('hex');
}

function buildCanonical(agentCode, timestampMs, nonce, bodySha256Hex) {
    return [CANONICAL_VERSION, agentCode ?? '', String(timestampMs), nonce ?? '', bodySha256Hex ?? ''].join('\n');
}

function base64UrlEncode(bytes) {
    return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomNonce() {
    return crypto.randomBytes(16).toString('hex');
}

async function signRequest(agentCode, requestSignPrivateKeyBase64, requestBody, timestampMs, nonce) {
    const bodyHash = sha256Hex(requestBody);
    const ts = timestampMs ?? Date.now();
    const n = (nonce && nonce.trim()) || randomNonce();
    const canonical = buildCanonical(agentCode, ts, n, bodyHash);
    const privateKey = Buffer.from(requestSignPrivateKeyBase64, 'base64');
    const signature = await ed25519.sign(new TextEncoder().encode(canonical), privateKey);

    return {
        bodyHash,
        canonical,
        timestampMs: ts,
        nonce: n,
        signature: base64UrlEncode(signature),
        headers: {
            [SIG.ALG]: ALGORITHM,
            [SIG.AGENT]: agentCode,
            [SIG.TIMESTAMP]: String(ts),
            [SIG.NONCE]: n,
            [SIG.BODY_HASH]: bodyHash,
            [SIG.VALUE]: base64UrlEncode(signature),
        },
    };
}

async function verifyCallback(callbackVerifyPublicKeyBase64, agentCode, callbackBody, headers) {
    const sigValue = headers[SIG.VALUE];
    if (!sigValue) return { verified: false, error: 'No signature headers' };

    const bodyHash = sha256Hex(callbackBody);
    if (bodyHash.toLowerCase() !== String(headers[SIG.BODY_HASH] || '').toLowerCase()) {
        return { verified: false, error: 'Body hash mismatch' };
    }

    const ts = Number(headers[SIG.TIMESTAMP]);
    if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
        return { verified: false, error: 'Signature expired' };
    }

    if (headers[SIG.ALG] !== ALGORITHM) return { verified: false, error: 'Invalid signature algorithm' };
    if (headers[SIG.AGENT] !== agentCode) return { verified: false, error: 'Signature agent mismatch' };

    const canonical = buildCanonical(agentCode, ts, headers[SIG.NONCE], headers[SIG.BODY_HASH]);
    const publicKey = Buffer.from(callbackVerifyPublicKeyBase64, 'base64');
    const verified = await ed25519.verify(
        Buffer.from(sigValue.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
        new TextEncoder().encode(canonical),
        publicKey
    );

    return { verified, error: verified ? '' : 'Invalid signature', bodyHash, canonical };
}

module.exports = {
    SIG,
    ALGORITHM,
    sha256Hex,
    buildCanonical,
    signRequest,
    verifyCallback,
};
