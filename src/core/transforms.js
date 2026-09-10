/**
 * What actually happens to a marker on its way through the world.
 *
 * Every claim about "this carrier survives Google Docs" is a guess unless you
 * measure it, so Carbonite ships the measurement instead of the guess: apply a
 * transform, re-extract, report. The transforms below approximate real
 * pipelines; `carbonite simulate` runs them against your own document.
 */

export const TRANSFORMS = [
  {
    id: 'identity',
    label: 'No change',
    describe: 'Baseline — the document exactly as issued.',
    apply: (t) => t,
  },
  {
    id: 'nfc',
    label: 'Unicode NFC',
    describe: 'Canonical composition, applied by many form fields and databases.',
    apply: (t) => t.normalize('NFC'),
  },
  {
    id: 'nfkc',
    label: 'Unicode NFKC',
    describe: 'Compatibility normalisation, used by some search and login pipelines.',
    apply: (t) => t.normalize('NFKC'),
  },
  {
    id: 'nfkd',
    label: 'Unicode NFKD',
    describe: 'Compatibility decomposition — the harshest normalisation in common use.',
    apply: (t) => t.normalize('NFKD'),
  },
  {
    id: 'bmp-only',
    label: 'Drop astral characters',
    describe: 'Approximates older PDF extractors and legacy database columns that hold only BMP text.',
    apply: (t) => [...t].filter((ch) => ch.codePointAt(0) <= 0xffff).join(''),
  },
  {
    id: 'ascii-only',
    label: 'ASCII only',
    describe: 'Plain-text email gateways, some LMS fields, `iconv //TRANSLIT`.',
    apply: (t) => [...t].filter((ch) => ch.codePointAt(0) < 0x80).join(''),
  },
  {
    id: 'strip-format',
    label: 'Deliberate scrubbing',
    describe: 'A student who knows about invisible characters and removes them.',
    apply: (t) => [...t].filter((ch) => !/[\p{Cf}\p{Co}︀-️]/u.test(ch)
      && !(ch.codePointAt(0) >= 0xe0100 && ch.codePointAt(0) <= 0xe01ef)).join(''),
  },
  {
    id: 'collapse-whitespace',
    label: 'Collapse whitespace',
    describe: 'HTML rendering and single-line form fields.',
    apply: (t) => t.replace(/\s+/g, ' ').trim(),
  },
  {
    id: 'line-wrap',
    label: 'Hard line wrap',
    describe: 'Wrapped at 72 columns, as in plain-text email.',
    apply: (t) => t.replace(/(.{1,72})(\s+|$)/gu, '$1\n'),
  },
  {
    id: 'first-paragraph',
    label: 'First paragraph only',
    describe: 'A student copies just the opening of the handout.',
    apply: (t) => t.split(/\n\s*\n/)[0] || t,
  },
  {
    id: 'truncate-half',
    label: 'First half',
    describe: 'A partial copy — the most common real-world loss.',
    apply: (t) => t.slice(0, Math.ceil(t.length / 2)),
  },
  {
    id: 'retype',
    label: 'Retyped by hand',
    describe: 'Visible characters only. Nothing survives this, by definition.',
    apply: (t) => [...t].filter((ch) => !/[\p{Cf}\p{Co}]/u.test(ch)
      && !(ch.codePointAt(0) >= 0xfe00 && ch.codePointAt(0) <= 0xfe0f)
      && !(ch.codePointAt(0) >= 0xe0000 && ch.codePointAt(0) <= 0xe01ef)).join(''),
  },
];

export function listTransforms() {
  return TRANSFORMS.map(({ apply, ...meta }) => meta);
}

export function getTransform(id) {
  const transform = TRANSFORMS.find((t) => t.id === id);
  if (!transform) throw new Error(`unknown transform "${id}"`);
  return transform;
}

export function applyTransform(id, text) {
  return getTransform(id).apply(String(text));
}

/**
 * Run every transform against a marked document and report what still verifies.
 * @param {string} document
 * @param {{keys?: any[], extract: Function, transforms?: string[]}} options
 */
export async function simulate(document, { keys = [], extract, transforms } = {}) {
  if (typeof extract !== 'function') throw new Error('simulate() needs the extract function');
  const ids = transforms || TRANSFORMS.map((t) => t.id);
  const rows = [];
  for (const id of ids) {
    const transform = getTransform(id);
    const mutated = transform.apply(String(document));
    const result = await extract(mutated, { keys });
    const byCodec = {};
    for (const marker of result.markers) {
      for (const codec of marker.codecs) {
        byCodec[codec] = (byCodec[codec] || 0) + marker.positions.length;
      }
    }
    rows.push({
      transform: id,
      label: transform.label,
      describe: transform.describe,
      markers: result.markers.length,
      copies: result.markers.reduce((n, m) => n + m.copies, 0),
      signatures: result.markers.map((m) => m.macStatus),
      damaged: result.damaged.length,
      byCodec,
      survived: result.markers.length > 0,
    });
  }
  return { rows, survivalRate: rows.filter((r) => r.survived).length / rows.length };
}
