import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalJson, packFrame, unpackFrame } from '../src/core/frame.js';
import { generateKey, keyIdFor, tokenFromNonce } from '../src/core/sign.js';
import { utf8Encode } from '../src/core/bytes.js';

const payload = { v: 1, id: 'cbn_abcdef', p: 'This assignment carries an integrity marker.' };

describe('frame', () => {
  it('round-trips a payload', async () => {
    const parsed = await unpackFrame(await packFrame(payload));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.payload, payload);
    assert.equal(parsed.macStatus, 'unsigned');
  });

  it('verifies a signature with the issuing key', async () => {
    const key = await generateKey();
    const parsed = await unpackFrame(await packFrame(payload, { key }), { keys: [key] });
    assert.equal(parsed.macStatus, 'valid');
    assert.equal(parsed.key.kid, key.kid);
  });

  it('reports a foreign key rather than accepting it', async () => {
    const [mine, theirs] = await Promise.all([generateKey(), generateKey()]);
    const parsed = await unpackFrame(await packFrame(payload, { key: mine }), { keys: [theirs] });
    assert.equal(parsed.macStatus, 'unknown-key');
    assert.equal(parsed.ok, true, 'the payload is still readable without the key');
  });

  it('distinguishes "no key supplied" from "wrong key"', async () => {
    const key = await generateKey();
    const parsed = await unpackFrame(await packFrame(payload, { key }));
    assert.equal(parsed.macStatus, 'no-key');
  });

  it('picks the right key out of a keyring', async () => {
    const keys = await Promise.all([generateKey('a'), generateKey('b'), generateKey('c')]);
    const parsed = await unpackFrame(await packFrame(payload, { key: keys[1] }), { keys });
    assert.equal(parsed.key.label, 'b');
  });

  it('detects a single flipped bit anywhere in the frame', async () => {
    const frame = await packFrame(payload, { key: await generateKey() });
    for (let i = 0; i < frame.length; i++) {
      const damaged = frame.slice();
      damaged[i] ^= 0x01;
      const parsed = await unpackFrame(damaged);
      assert.equal(parsed.ok, false, `byte ${i} went undetected`);
    }
  });

  it('detects truncation', async () => {
    const frame = await packFrame(payload);
    const parsed = await unpackFrame(frame.slice(0, frame.length - 3));
    assert.equal(parsed.ok, false);
    assert.match(parsed.reason, /truncated/);
  });

  it('detects trailing junk', async () => {
    const frame = await packFrame(payload);
    const parsed = await unpackFrame(Uint8Array.from([...frame, 0, 0]));
    assert.match(parsed.reason, /over-long/);
  });

  it('says plainly when bytes are not a marker at all', async () => {
    const parsed = await unpackFrame(utf8Encode('just some text here'));
    assert.match(parsed.reason, /not a Carbonite frame/);
  });

  it('never throws on arbitrary input', async () => {
    for (const bytes of [new Uint8Array(0), new Uint8Array(3), Uint8Array.from([0x43, 0x42, 0x4e, 9, 0, 0, 2, 1, 1, 1, 1])]) {
      const parsed = await unpackFrame(bytes);
      assert.equal(parsed.ok, false);
      assert.equal(typeof parsed.reason, 'string');
    }
  });

  it('refuses a payload larger than one frame', async () => {
    await assert.rejects(packFrame({ p: 'p'.repeat(200000) }, { compress: false }), /too large/);
  });

  it('compresses when that makes the frame smaller', async () => {
    const repetitive = { v: 1, id: 'cbn_abcdef', p: 'marker '.repeat(80) };
    const compressed = await packFrame(repetitive);
    const raw = await packFrame(repetitive, { compress: false });
    assert.ok(compressed.length < raw.length);
    assert.deepEqual((await unpackFrame(compressed)).payload, repetitive);
  });

  it('serialises JSON canonically, whatever the key order', () => {
    assert.equal(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] }), canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }));
  });
});

describe('keys and tokens', () => {
  it('derives a stable key id', async () => {
    const key = await generateKey();
    assert.equal(await keyIdFor(key.secret), key.kid);
    assert.match(key.kid, /^[0-9a-f]{8}$/);
  });

  it('derives a stable, readable token from a nonce', () => {
    assert.equal(tokenFromNonce('deadbeef'), tokenFromNonce('deadbeef'));
    assert.notEqual(tokenFromNonce('deadbeef'), tokenFromNonce('deadbeee'));
    assert.match(tokenFromNonce('deadbeef'), /^[a-z]+-[a-z]+-\d{2}$/);
  });
});
