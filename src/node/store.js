/**
 * Local, file-backed storage for keys and issued markers.
 *
 * Deliberately boring: two JSON files under ~/.carbonite (override with
 * CARBONITE_HOME). Keys are written 0600 because a leaked key lets someone else
 * issue markers in your name.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { emptyRegistry } from '../core/registry.js';

export function carboniteHome() {
  return process.env.CARBONITE_HOME || join(homedir(), '.carbonite');
}

export const keysPath = () => join(carboniteHome(), 'keys.json');
export const registryPath = () => join(carboniteHome(), 'registry.json');

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path} is not readable JSON (${error.message})`);
  }
}

async function writeJson(path, value, { secret = false } = {}) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (secret) {
    try {
      await chmod(path, 0o600);
    } catch {
      /* best effort: some filesystems do not support it */
    }
  }
  return path;
}

export async function loadKeys() {
  const data = await readJson(keysPath(), { version: 1, keys: [] });
  return Array.isArray(data.keys) ? data.keys : [];
}

export async function saveKey(key) {
  const keys = await loadKeys();
  const next = [...keys.filter((k) => k.kid !== key.kid), key];
  await writeJson(keysPath(), { version: 1, keys: next }, { secret: true });
  return key;
}

export async function findKey(selector) {
  const keys = await loadKeys();
  if (!keys.length) return null;
  if (!selector) return keys[keys.length - 1];
  return keys.find((k) => k.kid === selector || k.label === selector) || null;
}

export async function loadRegistry() {
  return readJson(registryPath(), emptyRegistry());
}

export async function saveRegistry(registry) {
  return writeJson(registryPath(), registry);
}
