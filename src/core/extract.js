/**
 * Reading markers back out of a document.
 *
 * Every registered codec scans the text; every candidate run is parsed as a
 * frame; identical copies collapse into one marker with a copy count. Runs that
 * fail to parse are kept, not discarded — "a marker that was edited" is a very
 * different finding from "no marker at all".
 */
import { scanAll } from './codecs/index.js';
import { toHex } from './bytes.js';
import { fromWire } from './payload.js';
import { unpackFrame } from './frame.js';
import { sha256Hex } from './bytes.js';

/**
 * @param {string} text
 * @param {{keys?: any[], codecs?: string[]}} [options]
 */
export async function extract(text, { keys = [], codecs } = {}) {
  const runs = scanAll(String(text), codecs ? { codecs } : undefined);
  const frames = [];

  for (const run of runs) {
    if (run.bytes.length === 0) continue;
    const parsed = await unpackFrame(run.bytes, { keys });
    frames.push({
      codec: run.codec,
      start: run.start,
      end: run.end,
      byteLength: run.bytes.length,
      partial: Boolean(run.partial),
      ...parsed,
      payload: parsed.ok ? fromWire(parsed.payload) : undefined,
      digest: parsed.ok ? await sha256Hex(run.bytes) : undefined,
    });
  }

  const readable = frames.filter((f) => f.ok);
  const damaged = frames.filter((f) => !f.ok && looksLikeCarbonite(f));

  const byId = new Map();
  for (const frame of readable) {
    const id = frame.payload?.id || `anonymous:${frame.digest?.slice(0, 8)}`;
    const marker = byId.get(id) || {
      id,
      payload: frame.payload,
      copies: 0,
      codecs: new Set(),
      positions: [],
      macStatus: frame.macStatus,
      key: frame.key,
      variants: new Set(),
    };
    marker.copies++;
    marker.codecs.add(frame.codec);
    marker.positions.push(frame.start);
    marker.variants.add(frame.digest);
    // "valid" beats every other status; "no-key" beats "unknown-key".
    if (frame.macStatus === 'valid') {
      marker.macStatus = 'valid';
      marker.key = frame.key;
    } else if (marker.macStatus !== 'valid' && frame.macStatus === 'no-key') {
      marker.macStatus = 'no-key';
    }
    byId.set(id, marker);
  }

  const markers = [...byId.values()].map((m) => ({
    ...m,
    codecs: [...m.codecs],
    variants: m.variants.size,
    inconsistent: m.variants.size > 1,
  }));

  return { runs, frames, markers, readable, damaged };
}

/**
 * Distinguish "a broken marker" from "an emoji with a variation selector".
 * A run that begins with our magic bytes was meant to be a marker.
 */
function looksLikeCarbonite(frame) {
  if (frame.reason?.startsWith('not a Carbonite frame')) return false;
  return frame.byteLength >= 4;
}

export { toHex };
