import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKey } from '../src/core/sign.js';

export const SAMPLE_ASSIGNMENT = [
  'HIST 210 - Essay 2: Explaining the Crash',
  '',
  "Write 700 words comparing two historians' explanations of the 1929 stock market crash.",
  '',
  'Use at least three sources, cited in Chicago style. Quotations should be short and analysed.',
  '',
  'Due Friday at 5pm.',
].join('\n');

export const key = () => generateKey('test');

export function tempHome() {
  return mkdtempSync(join(tmpdir(), 'carbonite-test-'));
}

export { join };
