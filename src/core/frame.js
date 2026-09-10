/**
 * The binary envelope that every codec carries.
 *
 *   magic "CBN" (3) | version (1) | flags (1) | bodyLen (2, BE) | body | [mac (8)] | crc16 (2, BE)
 *
 * The frame is codec-independent on purpose: the same bytes can travel as
 * variation selectors, zero-width characters, Unicode tags, or a visible
 * sentinel, and a verifier that understands one understands all of them.
 */
import {
  canCompress, concatBytes, crc16, deflateRaw, inflateRaw, utf8Decode, utf8Encode,
} from './bytes.js';
import { MAC_LENGTH, coerceSecret, findSigningKey, macBytes } from './sign.js';

export const MAGIC = Uint8Array.from([0x43, 0x42, 0x4e]); // "CBN"
export const FRAME_VERSION = 1;
export const FLAG_COMPRESSED = 0x01;
export const FLAG_SIGNED = 0x02;
export const HEADER_LENGTH = 7;
export const MAX_BODY_LENGTH = 0xffff;

/** Canonical JSON: keys sorted, so the same payload always hashes the same. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/**
 * @param {object} payload  the canary payload (see payload.js)
 * @param {{key?: any, compress?: boolean}} options
 * @returns {Promise<Uint8Array>}
 */
export async function packFrame(payload, { key = null, compress = 'auto' } = {}) {
  const json = utf8Encode(canonicalJson(payload));
  let body = json;
  let flags = 0;

  const wantCompression = compress === 'auto' ? canCompress() : compress && canCompress();
  if (wantCompression) {
    try {
      const deflated = await deflateRaw(json);
      if (deflated.length < json.length) {
        body = deflated;
        flags |= FLAG_COMPRESSED;
      }
    } catch {
      /* compression is an optimisation, never a requirement */
    }
  }

  if (body.length > MAX_BODY_LENGTH) {
    throw new Error(`payload is too large for one frame (${body.length} > ${MAX_BODY_LENGTH} bytes)`);
  }
  if (key) flags |= FLAG_SIGNED;

  const header = Uint8Array.from([
    ...MAGIC, FRAME_VERSION, flags, (body.length >> 8) & 0xff, body.length & 0xff,
  ]);
  let frame = concatBytes(header, body);
  if (key) frame = concatBytes(frame, await macBytes(key, frame));

  const sum = crc16(frame);
  return concatBytes(frame, Uint8Array.from([(sum >> 8) & 0xff, sum & 0xff]));
}

/**
 * Parse a frame. Never throws on malformed input: damage is data, and the
 * verifier needs to tell "not a marker" apart from "a marker someone edited".
 *
 * @returns {Promise<{ok: boolean, reason?: string, payload?: object,
 *   signed: boolean, compressed: boolean, macStatus: 'unsigned'|'valid'|'unknown-key'|'no-key',
 *   key?: object, bytes: Uint8Array}>}
 */
export async function unpackFrame(bytes, { keys = [] } = {}) {
  const fail = (reason, extra = {}) => ({
    ok: false, reason, signed: false, compressed: false, macStatus: 'unsigned', bytes, ...extra,
  });

  if (bytes.length < HEADER_LENGTH + 2) return fail('truncated: shorter than a minimal frame');
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) return fail('not a Carbonite frame (bad magic)');
  }

  const version = bytes[3];
  const flags = bytes[4];
  const compressed = Boolean(flags & FLAG_COMPRESSED);
  const signed = Boolean(flags & FLAG_SIGNED);
  const bodyLen = (bytes[5] << 8) | bytes[6];
  const macLen = signed ? MAC_LENGTH : 0;
  const expected = HEADER_LENGTH + bodyLen + macLen + 2;

  if (version !== FRAME_VERSION) {
    return fail(`unsupported frame version ${version} (this build understands ${FRAME_VERSION})`, { version });
  }
  if (bytes.length !== expected) {
    return fail(
      bytes.length < expected
        ? `truncated: expected ${expected} bytes, found ${bytes.length}`
        : `over-long: expected ${expected} bytes, found ${bytes.length}`,
      { version, signed, compressed },
    );
  }

  const stated = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
  if (crc16(bytes.slice(0, -2)) !== stated) {
    return fail('checksum mismatch: the marker was altered after it was written', { version, signed, compressed });
  }

  let macStatus = 'unsigned';
  let key;
  if (signed) {
    const macOffset = HEADER_LENGTH + bodyLen;
    const mac = bytes.slice(macOffset, macOffset + MAC_LENGTH);
    const usable = (keys || []).filter(Boolean);
    if (usable.length === 0) {
      macStatus = 'no-key';
    } else {
      key = await findSigningKey(usable, bytes.slice(0, macOffset), mac);
      macStatus = key ? 'valid' : 'unknown-key';
    }
  }

  let body = bytes.slice(HEADER_LENGTH, HEADER_LENGTH + bodyLen);
  if (compressed) {
    try {
      body = await inflateRaw(body);
    } catch {
      return fail('the marker body could not be decompressed', { version, signed, compressed });
    }
  }

  let payload;
  try {
    payload = JSON.parse(utf8Decode(body));
  } catch {
    return fail('the marker body is not valid JSON', { version, signed, compressed });
  }

  return { ok: true, payload, version, signed, compressed, macStatus, key, bytes };
}

export { coerceSecret };
