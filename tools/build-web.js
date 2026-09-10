#!/usr/bin/env node
/**
 * Bundle the Marker Desk into one self-contained HTML file.
 *
 * Carbonite has no dependencies and no build step for normal use — `web/` runs
 * straight from a static server. This exists only for places that must have a
 * single file (an artifact, an LMS page, a USB stick): it concatenates the
 * modules in dependency order and strips the import/export keywords, which is
 * safe precisely because there are no external packages to resolve.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Dependency order, checked by the duplicate-name guard below. */
const MODULES = [
  'src/core/bytes.js',
  'src/core/sign.js',
  'src/core/frame.js',
  'src/core/codecs/vs16.js',
  'src/core/codecs/zwj2.js',
  'src/core/codecs/tags.js',
  'src/core/codecs/sentinel.js',
  'src/core/codecs/index.js',
  'src/core/sanitize.js',
  'src/core/fingerprint.js',
  'src/core/payload.js',
  'src/core/anomalies.js',
  'src/core/placement.js',
  'src/core/promptGuard.js',
  'src/core/templates.js',
  'src/core/extract.js',
  'src/core/inject.js',
  'src/core/registry.js',
  'src/core/verify.js',
  'src/core/transforms.js',
  'src/core/channels.js',
  'web/app.js',
];

const DECLARATION = /^(?:export\s+)?(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/;

function flatten(source, path) {
  const name = basename(path, '.js');
  return source
    // import statements, single or multi-line
    .replace(/^import\s+[^;]*?;\s*$/gms, '')
    // re-exports and export lists carry nothing once everything shares a scope
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gms, '')
    // a default export becomes a const named after its file
    .replace(/^export\s+default\s+/m, `const ${name} = `)
    // everything else keeps its declaration, loses the keyword
    .replace(/^export\s+/gm, '')
    .trim();
}

function declaredNames(source) {
  const names = [];
  for (const line of source.split('\n')) {
    const match = DECLARATION.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

async function build() {
  const seen = new Map();
  const parts = [];

  for (const path of MODULES) {
    const source = await readFile(join(root, path), 'utf8');
    const flat = flatten(source, path);
    for (const name of declaredNames(flat)) {
      if (seen.has(name)) {
        throw new Error(`"${name}" is declared in both ${seen.get(name)} and ${path}; bundling them into one scope would clobber it`);
      }
      seen.set(name, path);
    }
    parts.push(`/* ===== ${path} ===== */\n${flat}`);
  }

  const html = await readFile(join(root, 'web/index.html'), 'utf8');
  const script = `<script type="module">\n${parts.join('\n\n')}\n</script>`;
  const bundled = html.replace('<script type="module" src="./app.js"></script>', script);
  if (bundled === html) throw new Error('could not find the app script tag in web/index.html');

  await mkdir(join(root, 'dist'), { recursive: true });
  const out = join(root, 'dist', 'carbonite.html');
  await writeFile(out, bundled, 'utf8');

  process.stdout.write(`${out}\n${Math.round(bundled.length / 1024)} KB, ${MODULES.length} modules, ${seen.size} top-level names\n`);
  return { out, script };
}

build().catch((error) => {
  process.stderr.write(`build failed: ${error.message}\n`);
  process.exit(1);
});
