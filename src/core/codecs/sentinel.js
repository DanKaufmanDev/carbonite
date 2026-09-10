/**
 * Visible sentinel codec.
 *
 * [[CBN1:<base64url>]] — deliberately visible, and deliberately ASCII. It exists
 * for the channels where invisible characters simply do not survive (plain-text
 * email, LaTeX, printed handouts that get retyped, LMS fields that strip
 * non-ASCII) and for teachers who would rather nothing about the marker be
 * hidden from students at all.
 */
import { b64uDecode, b64uEncode } from '../bytes.js';

const OPEN = '[[CBN1:';
const CLOSE = ']]';

export default {
  id: 'sentinel',
  label: 'Visible sentinel',
  description: 'A visible [[CBN1:…]] block in plain ASCII. Survives anything that survives text at all.',
  visible: true,
  needsBaseChar: false,
  charsPerByte: 1.34,
  accessibility: 'read-aloud',
  notes: 'Students can see and delete it. Use it when transparency matters more than stealth.',

  encode(bytes) {
    return OPEN + b64uEncode(bytes) + CLOSE;
  },

  scan(text) {
    const runs = [];
    // Accept the ASCII form and the typographic brackets some editors substitute.
    const re = /(?:\[\[|⟦)CBN1:([A-Za-z0-9_-]+)(?:\]\]|⟧)/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      let bytes = new Uint8Array(0);
      try {
        bytes = b64uDecode(match[1]);
      } catch {
        /* leave empty; the frame parser will report it as unreadable */
      }
      runs.push({ codec: 'sentinel', start: match.index, end: match.index + match[0].length, bytes });
    }
    return runs;
  },
};
