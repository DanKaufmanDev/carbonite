/**
 * Zero-width binary codec.
 *
 * ZERO WIDTH SPACE (U+200B) is a 0 bit, ZERO WIDTH NON-JOINER (U+200C) is a 1
 * bit, most-significant bit first. Eight characters per byte, so it is the
 * bulkiest carrier here — but it needs no base character, survives naive
 * copy/paste everywhere, and is trivial for a colleague to verify by hand.
 */
const ZERO = '​';
const ONE = '‌';

export function isBit(ch) {
  return ch === ZERO || ch === ONE;
}

export default {
  id: 'zwj2',
  label: 'Zero-width binary',
  description: 'Eight invisible zero-width characters per byte; needs no host character.',
  visible: false,
  needsBaseChar: false,
  charsPerByte: 8,
  accessibility: 'may-announce',
  notes: 'Widest editor support, but 8x the size and a few screen readers pause on long runs.',

  encode(bytes) {
    let out = '';
    for (const b of bytes) {
      for (let bit = 7; bit >= 0; bit--) out += (b >> bit) & 1 ? ONE : ZERO;
    }
    return out;
  },

  scan(text) {
    const runs = [];
    const re = /[​‌]+/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      const run = match[0];
      const whole = Math.floor(run.length / 8);
      const bytes = new Uint8Array(whole);
      for (let i = 0; i < whole; i++) {
        let b = 0;
        for (let bit = 0; bit < 8; bit++) b = (b << 1) | (run[i * 8 + bit] === ONE ? 1 : 0);
        bytes[i] = b;
      }
      runs.push({
        codec: 'zwj2',
        start: match.index,
        end: match.index + run.length,
        bytes,
        partial: run.length % 8 !== 0,
      });
    }
    return runs;
  },
};
