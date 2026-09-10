/**
 * Keys and message authentication.
 *
 * A Carbonite key is a 32-byte secret held by the teacher (or the department).
 * It answers one question at verification time: "is this marker one *I* issued,
 * exactly as I issued it?" Without a key a marker is still readable — anyone can
 * decode it — but it cannot be forged, and a forged one cannot be pinned on you.
 */
import { b64uDecode, b64uEncode, bytesEqual, randomBytes, sha256Hex, toHex, utf8Encode } from './bytes.js';

export const MAC_LENGTH = 8;

/** Key id: a short, non-secret handle so a verifier can pick the right key. */
export async function keyIdFor(secret) {
  const bytes = typeof secret === 'string' ? b64uDecode(secret) : secret;
  return (await sha256Hex(bytes)).slice(0, 8);
}

export async function generateKey(label = '') {
  const secret = randomBytes(32);
  return {
    kid: await keyIdFor(secret),
    secret: b64uEncode(secret),
    label,
    createdAt: new Date().toISOString(),
  };
}

/** Accepts a key record, a base64url string, or raw bytes. */
export function coerceSecret(key) {
  if (!key) return null;
  if (key instanceof Uint8Array) return key;
  if (typeof key === 'string') return b64uDecode(key);
  if (typeof key.secret === 'string') return b64uDecode(key.secret);
  throw new Error('unrecognised key format');
}

async function importKey(secret) {
  return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** Truncated HMAC-SHA256. 8 bytes is ample: forgery attempts are not oracles here. */
export async function macBytes(key, data) {
  const secret = coerceSecret(key);
  if (!secret) throw new Error('a key is required to sign');
  const cryptoKey = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data);
  return new Uint8Array(sig).slice(0, MAC_LENGTH);
}

export async function verifyMac(key, data, mac) {
  try {
    return bytesEqual(await macBytes(key, data), mac);
  } catch {
    return false;
  }
}

/**
 * Try every known key against a MAC. Returns the matching key record, or null.
 * Used by the verifier when a department shares one registry across many keys.
 */
export async function findSigningKey(keys, data, mac) {
  for (const key of keys || []) {
    if (await verifyMac(key, data, mac)) return key;
  }
  return null;
}

/** Deterministic, human-typable marker token derived from a nonce. */
export function tokenFromNonce(nonce, words = TOKEN_WORDS) {
  const bytes = typeof nonce === 'string' ? utf8Encode(nonce) : nonce;
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const a = words[h % words.length];
  const b = words[(h >>> 8) % words.length];
  const n = (h >>> 16) % 90 + 10;
  return `${a}-${b}-${n}`;
}

/** Neutral, memorable, unlikely to occur by accident in student prose. */
export const TOKEN_WORDS = [
  'amber', 'basalt', 'cinder', 'dune', 'ember', 'fjord', 'granite', 'harbor',
  'ivory', 'juniper', 'kelp', 'lantern', 'marble', 'nimbus', 'onyx', 'pumice',
  'quartz', 'ridge', 'slate', 'tundra', 'umber', 'vellum', 'willow', 'zephyr',
];

export { toHex };
