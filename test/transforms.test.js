import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyTransform, listTransforms, simulate } from '../src/core/transforms.js';
import { recommendCodecs, listChannels, registerChannel } from '../src/core/channels.js';
import { extract } from '../src/core/extract.js';
import { mark } from '../src/core/inject.js';
import { visibleText } from '../src/core/sanitize.js';
import { SAMPLE_ASSIGNMENT, key } from './helpers.js';

async function marked(codecs, k) {
  const result = await mark({
    assignment: { text: SAMPLE_ASSIGNMENT }, prompt: { template: 'token' },
    carrier: { codecs, placement: 'paragraphs' }, key: k,
  });
  return result.document;
}

describe('survival simulation', () => {
  it('never alters the visible words', () => {
    for (const transform of listTransforms()) {
      if (['ascii-only', 'truncate-half', 'first-paragraph', 'nfkd', 'nfkc'].includes(transform.id)) continue;
      const out = applyTransform(transform.id, SAMPLE_ASSIGNMENT);
      assert.equal(
        visibleText(out).replace(/\s+/g, ' ').trim(),
        SAMPLE_ASSIGNMENT.replace(/\s+/g, ' ').trim(),
        `${transform.id} changed the visible text`,
      );
    }
  });

  it('measures rather than assumes', async () => {
    const k = await key();
    const result = await simulate(await marked(['vs16'], k), { keys: [k], extract });
    const row = (id) => result.rows.find((r) => r.transform === id);
    assert.equal(row('identity').survived, true);
    assert.equal(row('retype').survived, false, 'retyping must destroy an invisible marker');
    assert.equal(row('strip-format').survived, false, 'a deliberate scrub must destroy it');
    assert.equal(row('nfc').survived, true);
  });

  it('shows that the visible sentinel outlasts the invisible carriers', async () => {
    const k = await key();
    const invisible = await simulate(await marked(['vs16'], k), { keys: [k], extract });
    const visible = await simulate(await marked(['sentinel'], k), { keys: [k], extract });
    assert.ok(visible.survivalRate > invisible.survivalRate);
    assert.equal(visible.rows.find((r) => r.transform === 'ascii-only').survived, true);
  });

  it('keeps the signature valid wherever the marker survives', async () => {
    const k = await key();
    const result = await simulate(await marked(['vs16', 'zwj2'], k), { keys: [k], extract });
    for (const row of result.rows.filter((r) => r.survived)) {
      assert.deepEqual([...new Set(row.signatures)], ['valid'], `${row.transform} lost the signature`);
    }
  });

  it('requires an extract implementation rather than guessing', async () => {
    await assert.rejects(simulate('x', {}), /needs the extract function/);
  });
});

describe('channel recommendations', () => {
  it('recommends two invisible carriers for ordinary online delivery', () => {
    const recommendation = recommendCodecs(['lms-rich-text', 'google-docs']);
    assert.deepEqual(recommendation.codecs, ['vs16', 'zwj2']);
    assert.equal(recommendation.confident, true);
  });

  it('falls back to the visible sentinel once paper is in the chain', () => {
    const recommendation = recommendCodecs(['printed', 'lms-rich-text']);
    assert.deepEqual(recommendation.codecs, ['sentinel']);
  });

  it('admits when no carrier survives the channels chosen', () => {
    registerChannel({
      id: 'hostile-test',
      label: 'A pipeline that mangles everything',
      expect: { vs16: 'none', zwj2: 'none', tags: 'none', sentinel: 'unreliable' },
      note: 'Test fixture.',
    });
    const recommendation = recommendCodecs(['hostile-test']);
    assert.equal(recommendation.confident, false);
    assert.match(recommendation.notes[0], /No invisible carrier|least bad/);
  });

  it('uses the visible sentinel for ASCII-only pipelines', () => {
    assert.equal(recommendCodecs(['ascii-gateway']).codecs[0], 'sentinel');
  });

  it('tells the truth about a determined student', () => {
    const channel = listChannels().find((c) => c.id === 'savvy-student');
    assert.equal(channel.expect.vs16, 'none');
    assert.match(channel.note, /not adversaries/);
  });

  it('names the alternatives for an unknown channel', () => {
    assert.throws(() => recommendCodecs(['carrier-pigeon']), /available:/);
  });
});
