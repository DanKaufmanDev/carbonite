/**
 * Codec registry.
 *
 * A codec turns frame bytes into text and finds them again. Adding a carrier is
 * a matter of dropping a module in beside these and registering it here —
 * nothing else in Carbonite knows how any particular carrier works.
 */
import sentinel from './sentinel.js';
import tags from './tags.js';
import vs16 from './vs16.js';
import zwj2 from './zwj2.js';

const REGISTRY = new Map();

export function registerCodec(codec) {
  for (const field of ['id', 'encode', 'scan']) {
    if (!codec?.[field]) throw new Error(`codec is missing "${field}"`);
  }
  REGISTRY.set(codec.id, codec);
  return codec;
}

[vs16, zwj2, tags, sentinel].forEach(registerCodec);

export function getCodec(id) {
  const codec = REGISTRY.get(id);
  if (!codec) {
    throw new Error(`unknown codec "${id}" (available: ${[...REGISTRY.keys()].join(', ')})`);
  }
  return codec;
}

export function listCodecs() {
  return [...REGISTRY.values()];
}

export function codecIds() {
  return [...REGISTRY.keys()];
}

/** Every candidate run in `text`, from every registered codec, in document order. */
export function scanAll(text, { codecs = codecIds() } = {}) {
  const runs = [];
  for (const id of codecs) runs.push(...getCodec(id).scan(text));
  return runs.sort((a, b) => a.start - b.start || a.end - b.end);
}

export { sentinel, tags, vs16, zwj2 };
