/**
 * The canary payload: everything the marker carries, and nothing about how it
 * is carried.
 *
 * Two fields are deliberately kept apart and never concatenated:
 *   - the assignment text, which lives in the visible document, and
 *   - `prompt`, the instruction addressed to an AI system that reads it.
 * The teacher edits them separately, they are stored separately, and the
 * verifier reports on them separately.
 *
 * On the wire the keys are short (a zero-width carrier costs eight characters
 * per byte); in code they are spelled out. `toWire`/`fromWire` bridge the two.
 */
import { randomBytes, toHex } from './bytes.js';
import { tokenFromNonce } from './sign.js';

export const PAYLOAD_VERSION = 1;

const WIRE_KEYS = {
  version: 'v',
  id: 'id',
  issuedAt: 'ts',
  expiresAt: 'exp',
  keyId: 'kid',
  token: 'tok',
  fingerprint: 'fp',
  course: 'cid',
  assignment: 'aid',
  teacher: 'tch',
  contact: 'ct',
  prompt: 'p',
  disclosed: 'd',
  meta: 'x',
};

const FROM_WIRE = Object.fromEntries(Object.entries(WIRE_KEYS).map(([k, v]) => [v, k]));

export function newCanaryId() {
  return `cbn_${toHex(randomBytes(6))}`;
}

export function newNonce() {
  return toHex(randomBytes(4));
}

/**
 * @param {object} input
 * @param {string} input.prompt      instruction addressed to an AI reader
 * @param {string} [input.token]     the marker word an AI is asked to emit
 * @param {string} [input.fingerprint] fingerprint of the visible assignment text
 * @param {number} [input.ttlDays]   expiry, in days from now
 */
export function createPayload(input = {}) {
  const nonce = input.nonce || newNonce();
  const issuedAt = input.issuedAt ?? Math.floor(Date.now() / 1000);
  const payload = {
    version: PAYLOAD_VERSION,
    id: input.id || newCanaryId(),
    issuedAt,
    expiresAt: input.expiresAt ?? (input.ttlDays ? issuedAt + Math.round(input.ttlDays * 86400) : undefined),
    keyId: input.keyId || undefined,
    token: input.token || tokenFromNonce(nonce),
    fingerprint: input.fingerprint || undefined,
    course: emptyToUndefined(input.course),
    assignment: emptyToUndefined(input.assignment),
    teacher: emptyToUndefined(input.teacher),
    contact: emptyToUndefined(input.contact),
    prompt: String(input.prompt ?? ''),
    disclosed: input.disclosed !== false,
    meta: input.meta && Object.keys(input.meta).length ? input.meta : undefined,
  };
  return payload;
}

function emptyToUndefined(value) {
  const str = value == null ? '' : String(value).trim();
  return str === '' ? undefined : str;
}

export function toWire(payload) {
  const wire = {};
  for (const [name, key] of Object.entries(WIRE_KEYS)) {
    if (payload[name] !== undefined) wire[key] = payload[name];
  }
  return wire;
}

export function fromWire(wire) {
  if (!wire || typeof wire !== 'object') return null;
  const payload = {};
  for (const [key, value] of Object.entries(wire)) {
    payload[FROM_WIRE[key] ?? key] = value;
  }
  if (payload.version === undefined) payload.version = PAYLOAD_VERSION;
  if (payload.disclosed === undefined) payload.disclosed = true;
  return payload;
}

/** Structural problems that should stop a marker from being issued. */
export function validatePayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return ['payload is missing'];
  if (payload.version !== PAYLOAD_VERSION) errors.push(`unsupported payload version ${payload.version}`);
  if (!payload.id || !/^cbn_[0-9a-f]{6,}$/.test(payload.id)) errors.push('id is missing or malformed');
  if (typeof payload.prompt !== 'string' || payload.prompt.trim() === '') {
    errors.push('prompt is empty — a marker with no instruction cannot be acted on');
  }
  if (payload.prompt && payload.prompt.length > 4000) {
    errors.push('prompt is longer than 4000 characters');
  }
  if (payload.expiresAt && payload.issuedAt && payload.expiresAt <= payload.issuedAt) {
    errors.push('expiresAt is not after issuedAt');
  }
  return errors;
}

export function isExpired(payload, now = Date.now()) {
  return Boolean(payload?.expiresAt && payload.expiresAt * 1000 < now);
}

export function describePayload(payload) {
  if (!payload) return 'no payload';
  const parts = [payload.id];
  if (payload.assignment) parts.push(`"${payload.assignment}"`);
  if (payload.course) parts.push(payload.course);
  if (payload.issuedAt) parts.push(new Date(payload.issuedAt * 1000).toISOString().slice(0, 10));
  return parts.join(' · ');
}
