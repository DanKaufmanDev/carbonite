/**
 * Unicode tag-character codec.
 *
 * The frame is base64url-encoded, then each ASCII character is shifted into the
 * deprecated tag block (U+E0020-U+E007E) and wrapped in U+E0001 ... U+E007F.
 * The explicit delimiters make a run self-describing, which is what you want
 * when a document has been chopped up and reassembled.
 */
import { b64uDecode, b64uEncode, utf8Encode } from '../bytes.js';

const START = '\u{e0001}';
const END = '\u{e007f}';
const OFFSET = 0xe0000;

export function isTagChar(cp) {
  return cp >= 0xe0001 && cp <= 0xe007f;
}

export default {
  id: 'tags',
  label: 'Unicode tag characters',
  description: 'Deprecated tag block, base64url, explicitly delimited.',
  visible: false,
  needsBaseChar: false,
  charsPerByte: 1.34,
  accessibility: 'silent',
  notes: 'Self-delimiting and silent, but some platforms actively strip the tag block.',

  encode(bytes) {
    const text = b64uEncode(bytes);
    let out = START;
    for (const ch of text) out += String.fromCodePoint(OFFSET + ch.charCodeAt(0));
    return out + END;
  },

  scan(text) {
    const runs = [];
    let start = -1;
    let chars = '';
    let index = 0;
    const flush = (end) => {
      if (start === -1) return;
      let bytes = new Uint8Array(0);
      try {
        if (chars) bytes = b64uDecode(chars);
      } catch {
        bytes = utf8Encode('');
      }
      runs.push({ codec: 'tags', start, end, bytes });
      start = -1;
      chars = '';
    };
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp === 0xe0001) {
        flush(index);
        start = index;
      } else if (cp === 0xe007f) {
        if (start !== -1) flush(index + ch.length);
      } else if (isTagChar(cp) && start !== -1) {
        chars += String.fromCharCode(cp - OFFSET);
      } else if (start !== -1 && !isTagChar(cp)) {
        flush(index);
      }
      index += ch.length;
    }
    flush(index);
    return runs;
  },
};
