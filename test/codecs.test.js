import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { codecIds, getCodec, listCodecs, registerCodec, scanAll } from '../src/core/codecs/index.js';
import { visibleText } from '../src/core/sanitize.js';

const randomBytes = (n) => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256));

describe('codecs', () => {
  for (const codec of listCodecs()) {
    describe(codec.id, () => {
      it('round-trips every byte value', () => {
        const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
        const host = codec.needsBaseChar ? 'a' : '';
        const runs = codec.scan(host + codec.encode(bytes));
        assert.equal(runs.length, 1);
        assert.deepEqual([...runs[0].bytes], [...bytes]);
      });

      it('round-trips random payloads of varied length', () => {
        for (const length of [1, 7, 64, 400]) {
          const bytes = randomBytes(length);
          const runs = codec.scan(`x${codec.encode(bytes)}y`);
          assert.deepEqual([...runs[0].bytes], [...bytes], `length ${length}`);
        }
      });

      it('reports positions that bracket the carrier', () => {
        const encoded = codec.encode(randomBytes(20));
        const text = `before ${encoded} after`;
        const [run] = codec.scan(text);
        assert.equal(text.slice(run.start, run.end).includes(encoded.slice(0, 2)), true);
      });

      it('finds several independent copies', () => {
        const bytes = randomBytes(24);
        const encoded = codec.encode(bytes);
        const runs = codec.scan(`a${encoded} b${encoded} c${encoded}`);
        assert.equal(runs.length, 3);
        runs.forEach((run) => assert.deepEqual([...run.bytes], [...bytes]));
      });

      it('finds nothing in unmarked prose', () => {
        assert.deepEqual(codec.scan('An ordinary sentence, with punctuation - and a dash.'), []);
      });

      it('declares whether it is visible, and behaves that way', () => {
        const encoded = codec.encode(randomBytes(16));
        const hidden = visibleText(`x${encoded}`) === 'x';
        assert.equal(hidden, !codec.visible);
      });
    });
  }

  it('does not mistake emoji for a marker', () => {
    const runs = scanAll('Great work! ❤️ 👍🏽 🚀');
    const decodable = runs.filter((r) => r.bytes.length >= 4);
    assert.deepEqual(decodable, []);
  });

  it('scans every codec in one pass, in document order', () => {
    const bytes = randomBytes(12);
    let text = 'x';
    for (const id of codecIds()) text += `${getCodec(id).encode(bytes)} y`;
    const runs = scanAll(text);
    assert.equal(runs.length, codecIds().length);
    assert.deepEqual(runs.map((r) => r.start), [...runs.map((r) => r.start)].sort((a, b) => a - b));
  });

  it('rejects an incomplete codec at registration', () => {
    assert.throws(() => registerCodec({ id: 'broken' }), /missing "encode"/);
  });

  it('names the alternatives when asked for a codec that does not exist', () => {
    assert.throws(() => getCodec('nope'), /available: vs16/);
  });
});
