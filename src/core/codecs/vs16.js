/**
 * Variation-selector codec.
 *
 * Every byte maps to one variation selector: 0x00-0x0F to U+FE00-U+FE0F,
 * 0x10-0xFF to U+E0100-U+E01EF. Variation selectors modify the character in
 * front of them, so a run must follow a visible base character; renderers that
 * have no variant to apply draw nothing at all.
 *
 * Best all-round carrier: dense (one character per byte), silent in screen
 * readers, and preserved by most rich-text editors and clipboards.
 */
const LOW_BASE = 0xfe00;   // 16 selectors
const HIGH_BASE = 0xe0100; // 240 selectors

export function isSelector(cp) {
  return (cp >= LOW_BASE && cp <= 0xfe0f) || (cp >= HIGH_BASE && cp <= 0xe01ef);
}

function byteToCp(b) {
  return b < 16 ? LOW_BASE + b : HIGH_BASE + (b - 16);
}

function cpToByte(cp) {
  return cp <= 0xfe0f ? cp - LOW_BASE : cp - HIGH_BASE + 16;
}

export default {
  id: 'vs16',
  label: 'Variation selectors',
  description: 'One invisible selector per byte, riding on the character before it.',
  visible: false,
  needsBaseChar: true,
  charsPerByte: 1,
  accessibility: 'silent',
  notes: 'Densest invisible carrier. Removed by Unicode NFKD normalisation and by some plain-text exporters.',

  encode(bytes) {
    let out = '';
    for (const b of bytes) out += String.fromCodePoint(byteToCp(b));
    return out;
  },

  scan(text) {
    const runs = [];
    let start = -1;
    let bytes = [];
    let index = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (isSelector(cp)) {
        if (start === -1) start = index;
        bytes.push(cpToByte(cp));
      } else if (start !== -1) {
        runs.push({ codec: 'vs16', start, end: index, bytes: Uint8Array.from(bytes) });
        start = -1;
        bytes = [];
      }
      index += ch.length;
    }
    if (start !== -1) runs.push({ codec: 'vs16', start, end: index, bytes: Uint8Array.from(bytes) });
    return runs;
  },
};
