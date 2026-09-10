#!/usr/bin/env node
/**
 * Carbonite command line.
 *
 *   carbonite mark    - author a marked assignment
 *   carbonite audit   - check a marked document before you hand it out
 *   carbonite verify  - check a submission that came back
 *
 * Every command takes --json for a machine-readable report, so the tool can sit
 * inside a marking script as easily as in a terminal.
 */
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { mark, noticeText } from '../src/core/inject.js';
import { extract } from '../src/core/extract.js';
import { auditDocument, verifySubmission } from '../src/core/verify.js';
import { listCodecs } from '../src/core/codecs/index.js';
import { listStrategies } from '../src/core/placement.js';
import { listTemplates, renderTemplate } from '../src/core/templates.js';
import { listRules, reviewPrompt } from '../src/core/promptGuard.js';
import { listChannels, recommendCodecs } from '../src/core/channels.js';
import { listTransforms, simulate } from '../src/core/transforms.js';
import { scanAnomalies } from '../src/core/anomalies.js';
import { sanitize, stripCarbonite } from '../src/core/sanitize.js';
import { generateKey } from '../src/core/sign.js';
import { addRecord, listRecords, findById, recordFor, removeRecord } from '../src/core/registry.js';
import { describePayload } from '../src/core/payload.js';
import * as store from '../src/node/store.js';
import { bullet, heading, renderAudit, renderVerify, style, table, wrapText } from '../src/node/render.js';

const USAGE = `
carbonite - author assignments that carry an AI-directed integrity marker,
            then check what comes back.

Usage
  carbonite <command> [options]

Authoring
  keygen [--label <name>]                 create a signing key (stored locally)
  mark --assignment <file> [options]      write a marked document
  audit <file>                            check a marked document before handing it out

Checking
  verify <file> [--expect <id>]           check a student submission
  inspect <file>                          decode any markers found, no judgement
  scan <file>                             report hidden characters of every kind
  strip <file>                            remove markers and hidden characters
  simulate <file>                         measure which channels the marker survives

Reference
  templates | codecs | placements | rules | channels | transforms
  registry list|show <id>|rm <id>
  doctor                                  self-test this installation

Common options
  --key <kid|label>     signing key to use (default: most recent)
  --json                machine-readable output
  --out <file>          write output to a file instead of stdout
  --no-registry         do not read or write the local registry

mark options
  --assignment <file>   assignment text ("-" for stdin)          [required]
  --prompt <file>       AI-directed instruction, as a file
  --template <id>       or a built-in instruction (default: notice)
  --title, --course, --teacher, --contact
  --codec <a,b>         carriers (default: vs16)
  --placement <id>      end | start | paragraphs | sentences | spread
  --copies <n>          copies of the marker (default: 3)
  --ttl-days <n>        marker expiry
  --notice footer       append a visible disclosure line
  --allow <rule-id>     acknowledge one blocking safety finding (recorded in the marker)
`;

function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s);
      const name = rawName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inlineValue !== undefined) {
        options[name] = inlineValue;
      } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        options[name] = argv[++i];
      } else {
        options[name] = true;
      }
      if (name.startsWith('no') && options[name] === true) options[lowerFirst(name.slice(2))] = false;
    } else {
      positionals.push(arg);
    }
  }
  return { options, positionals };
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

async function readInput(pathOrDash) {
  if (!pathOrDash) throw new UserError('a file path is required (use "-" to read stdin)');
  if (pathOrDash === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  }
  return readFile(pathOrDash, 'utf8');
}

class UserError extends Error {}

async function output(text, options) {
  if (options.out && options.out !== true) {
    await writeFile(options.out, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    if (!options.json) process.stderr.write(`${style.dim(`written to ${options.out}`)}\n`);
    return;
  }
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

const asJson = (value) => JSON.stringify(value, replacer, 2);
function replacer(key, value) {
  if (value instanceof Uint8Array) return undefined;
  if (value instanceof Set) return [...value];
  if (key === 'bytes' || key === 'runs' || key === 'frames') return undefined;
  return value;
}

/* ------------------------------------------------------------------ commands */

const commands = {
  async keygen(_positionals, options) {
    const key = await generateKey(options.label === true ? '' : options.label || '');
    if (options.print) {
      await output(options.json ? asJson(key) : `${key.kid}  ${key.secret}`, options);
      return 0;
    }
    await store.saveKey(key);
    await output(options.json ? asJson({ ...key, storedAt: store.keysPath() }) : [
      heading('New signing key'),
      bullet(`key id  ${style.cyan(key.kid)}`),
      bullet(`label   ${key.label || '(none)'}`),
      bullet(`stored  ${store.keysPath()}`),
      '',
      style.dim(wrapText('Back this file up. Without the key you cannot prove a marker is yours, and markers issued with a lost key verify as "unknown-key" forever.', 78, 2)),
    ].join('\n'), options);
    return 0;
  },

  async mark(_positionals, options) {
    if (!options.assignment) throw new UserError('--assignment <file> is required');
    const text = await readInput(options.assignment);
    const promptText = options.prompt ? await readInput(options.prompt) : undefined;
    const key = options.unsigned ? null : await store.findKey(options.key === true ? undefined : options.key);

    if (!key && !options.unsigned) {
      process.stderr.write(`${style.yellow('No signing key found. Run `carbonite keygen` first, or pass --unsigned.')}\n`);
      return 2;
    }

    const result = await mark({
      assignment: {
        text,
        title: str(options.title),
        course: str(options.course),
        teacher: str(options.teacher),
        contact: str(options.contact),
      },
      prompt: {
        text: promptText,
        template: str(options.template),
        allow: options.allow ? String(options.allow).split(',') : [],
      },
      carrier: {
        codecs: options.codec ? String(options.codec).split(',') : undefined,
        placement: str(options.placement),
        copies: options.copies ? Number(options.copies) : undefined,
        seed: options.seed ? Number(options.seed) : undefined,
      },
      key,
      ttlDays: options.ttlDays ? Number(options.ttlDays) : undefined,
      disclosed: options.undisclosed ? false : true,
      notice: options.notice === true ? 'footer' : str(options.notice),
    });

    if (!result.ok) {
      process.stderr.write(`${style.red('The marker was not issued.')} ${result.reason}\n\n`);
      for (const finding of result.review?.findings || []) {
        process.stderr.write(`  ${finding.severity === 'block' ? style.red('[block]') : style.yellow(`[${finding.severity}]`)} ${style.bold(finding.id)} ${finding.message}\n`);
        process.stderr.write(`${style.dim(wrapText(finding.advice, 78, 10))}\n`);
        if (finding.match) process.stderr.write(`${style.dim(`          matched: "${finding.match}"`)}\n`);
      }
      process.stderr.write(`\n${style.dim(wrapText('If a rule has misfired on wording you are sure about, acknowledge it explicitly: --allow <rule-id>. The override is recorded inside the marker.', 78, 2))}\n`);
      return 1;
    }

    if (options.registry !== false) {
      const registry = await store.loadRegistry();
      await store.saveRegistry(addRecord(registry, await recordFor({
        payload: result.payload,
        assignmentText: text,
        promptText: result.payload.prompt,
        carrier: { codecs: result.insertions.map((i) => i.codec), placement: str(options.placement) || 'spread' },
        document: result.document,
      })));
    }

    if (options.json) {
      await output(asJson(result), options);
      return 0;
    }

    // The document itself goes to stdout or --out; the summary goes to stderr,
    // so `carbonite mark ... > handout.txt` produces a clean file.
    await output(result.document, options);
    const summary = [
      heading('Marked'),
      bullet(`marker    ${result.payload.id}`),
      bullet(`token     ${style.cyan(result.token)}   ${style.dim('(this is what to look for in a submission)')}`),
      bullet(`carriers  ${[...new Set(result.insertions.map((i) => i.codec))].join(', ')} x${result.insertions.length}`),
      bullet(`size      ${result.stats.assignmentChars} visible + ${result.stats.hiddenChars} hidden characters`),
      bullet(`signed    ${result.payload.keyId ? `yes (${result.payload.keyId})` : 'no'}`),
      '',
      style.dim(wrapText(`Instruction sent to an AI reader: ${result.payload.prompt}`, 78, 2)),
    ];
    for (const warning of result.warnings) summary.push(`\n${style.yellow('warning')} ${wrapText(warning, 78, 2).trim()}`);
    for (const finding of result.review.findings.filter((f) => f.severity !== 'info')) {
      summary.push(`\n${style.yellow(`[${finding.severity}]`)} ${finding.message} ${style.dim(finding.advice)}`);
    }
    summary.push(`\n${style.dim(wrapText(`Suggested syllabus line: ${result.suggestedNotice}`, 78, 2))}`);
    process.stderr.write(`${summary.join('\n')}\n`);
    return 0;
  },

  async audit(positionals, options) {
    const document = await readInput(positionals[0]);
    const keys = await store.loadKeys();
    const registry = options.registry === false ? undefined : await store.loadRegistry();
    const original = options.original ? await readInput(options.original) : undefined;
    const report = await auditDocument(document, { keys, registry, originalText: original });
    await output(options.json ? asJson(report) : renderAudit(report), options);
    return report.ok ? 0 : 1;
  },

  async verify(positionals, options) {
    const submission = await readInput(positionals[0]);
    const keys = await store.loadKeys();
    const registry = options.registry === false ? undefined : await store.loadRegistry();
    const assignmentText = options.assignment ? await readInput(options.assignment) : undefined;
    const report = await verifySubmission(submission, {
      keys,
      registry,
      assignmentText,
      expectId: str(options.expect),
      tokens: options.token ? String(options.token).split(',') : [],
    });
    await output(options.json ? asJson(report) : renderVerify(report), options);
    return report.verdict.code === 'no-signal' ? 0 : 3;
  },

  async inspect(positionals, options) {
    const text = await readInput(positionals[0]);
    const keys = await store.loadKeys();
    const found = await extract(text, { keys });
    if (options.json) {
      await output(asJson(found), options);
      return 0;
    }
    const out = [heading(`Markers (${found.markers.length}) and damaged fragments (${found.damaged.length})`)];
    for (const marker of found.markers) {
      out.push(bullet(style.bold(describePayload(marker.payload))));
      out.push(`      token      ${style.cyan(marker.payload.token)}`);
      out.push(`      copies     ${marker.copies} via ${marker.codecs.join(', ')} at ${marker.positions.join(', ')}`);
      out.push(`      signature  ${marker.macStatus}${marker.key?.label ? ` (${marker.key.label})` : ''}`);
      out.push(`      disclosed  ${marker.payload.disclosed === false ? 'no' : 'yes'}`);
      out.push('      instruction:');
      out.push(style.dim(wrapText(marker.payload.prompt, 78, 8)));
    }
    for (const frame of found.damaged) {
      out.push(bullet(`${style.yellow('damaged')} ${frame.codec} at ${frame.start}: ${frame.reason}`));
    }
    if (!found.markers.length && !found.damaged.length) out.push(style.dim('  No Carbonite markers in this text.'));
    await output(out.join('\n'), options);
    return 0;
  },

  async scan(positionals, options) {
    const text = await readInput(positionals[0]);
    const found = await extract(text, { keys: await store.loadKeys() });
    const anomalies = scanAnomalies(text, { knownRuns: found.runs });
    if (options.json) {
      await output(asJson({ markers: found.markers.length, anomalies }), options);
      return 0;
    }
    const out = [heading('Hidden content scan')];
    out.push(bullet(`${found.markers.length} Carbonite marker(s), ${found.damaged.length} damaged fragment(s)`));
    if (!anomalies.findings.length) out.push(bullet('Nothing else hidden in this text.'));
    for (const finding of anomalies.findings) {
      out.push(bullet(`${finding.severity.toUpperCase()} ${finding.type}: ${finding.detail}`));
      out.push(style.dim(wrapText(finding.advice, 78, 6)));
    }
    await output(out.join('\n'), options);
    return anomalies.findings.some((f) => f.severity === 'high') ? 3 : 0;
  },

  async strip(positionals, options) {
    const text = await readInput(positionals[0]);
    const cleaned = options.markersOnly ? stripCarbonite(text) : sanitize(text);
    await output(cleaned, options);
    if (!options.json) {
      process.stderr.write(`${style.dim(`removed ${[...text].length - [...cleaned].length} hidden character(s)`)}\n`);
    }
    return 0;
  },

  async simulate(positionals, options) {
    const document = await readInput(positionals[0]);
    const keys = await store.loadKeys();
    const result = await simulate(document, { keys, extract });
    if (options.json) {
      await output(asJson(result), options);
      return 0;
    }
    await output([
      heading('Marker survival by transform'),
      table(result.rows, [
        { label: 'transform', value: (r) => r.transform },
        { label: 'survives', value: (r) => (r.survived ? 'yes' : 'NO') },
        { label: 'copies', value: (r) => r.copies },
        { label: 'signature', value: (r) => [...new Set(r.signatures)].join(',') || '-' },
        { label: 'what it approximates', value: (r) => r.describe },
      ]),
      '',
      style.dim(wrapText(`${Math.round(result.survivalRate * 100)}% of simulated pipelines preserved a readable marker. These are approximations - confirm the channel you actually use with one real round trip.`, 78, 2)),
    ].join('\n'), options);
    return 0;
  },

  async templates(_positionals, options) {
    const templates = listTemplates();
    if (options.json) return output(asJson(templates), options).then(() => 0);
    const out = [heading('Instruction templates')];
    for (const t of templates) {
      out.push(bullet(`${style.bold(t.id)}  ${style.dim(`[${t.posture}]`)} ${t.label}`));
      out.push(wrapText(t.summary, 78, 6));
      if (t.caution) out.push(style.yellow(wrapText(`caution: ${t.caution}`, 78, 6)));
      out.push(style.dim(wrapText(renderTemplate(t.id, { token: 'amber-slate-42', course: 'ENG 101' }), 78, 6)));
      out.push('');
    }
    await output(out.join('\n'), options);
    return 0;
  },

  async codecs(_positionals, options) {
    const codecs = listCodecs().map(({ encode, scan, ...meta }) => meta);
    if (options.json) return output(asJson(codecs), options).then(() => 0);
    await output([
      heading('Carriers'),
      table(codecs, [
        { label: 'id', value: (c) => c.id },
        { label: 'visible', value: (c) => (c.visible ? 'yes' : 'no') },
        { label: 'chars/byte', value: (c) => c.charsPerByte },
        { label: 'screen reader', value: (c) => c.accessibility },
        { label: 'notes', value: (c) => c.notes },
      ]),
    ].join('\n'), options);
    return 0;
  },

  async placements(_positionals, options) {
    const strategies = listStrategies();
    if (options.json) return output(asJson(strategies), options).then(() => 0);
    await output([
      heading('Placement strategies'),
      table(strategies, [
        { label: 'id', value: (s) => s.id },
        { label: 'label', value: (s) => s.label },
        { label: 'what it does', value: (s) => s.describe },
      ]),
    ].join('\n'), options);
    return 0;
  },

  async rules(_positionals, options) {
    const rules = listRules();
    if (options.json) return output(asJson(rules), options).then(() => 0);
    const out = [heading('Instruction safety rules')];
    for (const rule of rules) {
      out.push(bullet(`${severityColour(rule.severity)} ${style.bold(rule.id)} - ${rule.message}`));
      out.push(style.dim(wrapText(rule.advice, 78, 6)));
    }
    await output(out.join('\n'), options);
    return 0;
  },

  async channels(_positionals, options) {
    const channels = listChannels();
    if (options.json) return output(asJson(channels), options).then(() => 0);
    const out = [
      heading('Delivery channels (expectations, not measurements)'),
      table(channels, [
        { label: 'id', value: (c) => c.id },
        { label: 'vs16', value: (c) => c.expect.vs16 },
        { label: 'zwj2', value: (c) => c.expect.zwj2 },
        { label: 'tags', value: (c) => c.expect.tags },
        { label: 'sentinel', value: (c) => c.expect.sentinel },
      ]),
    ];
    if (options.for) {
      const recommendation = recommendCodecs(String(options.for).split(','));
      out.push(heading('Recommendation'));
      out.push(bullet(`--codec ${recommendation.codecs.join(',')}${recommendation.confident ? '' : style.yellow('  (no carrier is reliable across all of those)')}`));
      recommendation.notes.forEach((n) => out.push(style.dim(wrapText(n, 78, 6))));
    }
    await output(out.join('\n'), options);
    return 0;
  },

  async transforms(_positionals, options) {
    const transforms = listTransforms();
    if (options.json) return output(asJson(transforms), options).then(() => 0);
    await output([
      heading('Transforms used by `simulate`'),
      table(transforms, [
        { label: 'id', value: (t) => t.id },
        { label: 'approximates', value: (t) => t.describe },
      ]),
    ].join('\n'), options);
    return 0;
  },

  async registry(positionals, options) {
    const [action = 'list', id] = positionals;
    const registry = await store.loadRegistry();
    if (action === 'list') {
      const records = listRecords(registry, { course: str(options.course) });
      if (options.json) return output(asJson(records), options).then(() => 0);
      if (!records.length) {
        await output(style.dim('  No markers issued yet.'), options);
        return 0;
      }
      await output([
        heading(`Issued markers (${records.length})`),
        table(records, [
          { label: 'id', value: (r) => r.id },
          { label: 'issued', value: (r) => new Date(r.issuedAt * 1000).toISOString().slice(0, 10) },
          { label: 'course', value: (r) => r.course || '-' },
          { label: 'assignment', value: (r) => r.assignment || '-' },
          { label: 'token', value: (r) => r.token },
        ]),
      ].join('\n'), options);
      return 0;
    }
    if (action === 'show') {
      const record = findById(registry, id);
      if (!record) throw new UserError(`no marker with id "${id}" in the registry`);
      await output(options.json ? asJson(record) : [
        heading(record.id),
        bullet(`assignment  ${record.assignment || '-'}${record.course ? ` (${record.course})` : ''}`),
        bullet(`token       ${style.cyan(record.token)}`),
        bullet(`issued      ${new Date(record.issuedAt * 1000).toISOString()}`),
        bullet(`key         ${record.keyId || 'unsigned'}`),
        bullet('instruction:'),
        style.dim(wrapText(record.prompt, 78, 6)),
        bullet('assignment text:'),
        style.dim(wrapText(record.assignmentText || '(not stored)', 78, 6)),
      ].join('\n'), options);
      return 0;
    }
    if (action === 'rm') {
      if (!findById(registry, id)) throw new UserError(`no marker with id "${id}" in the registry`);
      await store.saveRegistry(removeRecord(registry, id));
      await output(`removed ${id}`, options);
      return 0;
    }
    throw new UserError(`unknown registry action "${action}" (list, show, rm)`);
  },

  async doctor(_positionals, options) {
    const { runDoctor } = await import('../src/node/doctor.js');
    const report = await runDoctor();
    if (options.json) return output(asJson(report), options).then(() => 0);
    const out = [heading('Self-test')];
    for (const check of report.checks) {
      const mark_ = check.ok ? style.green('ok  ') : style.red('FAIL');
      out.push(`  [${mark_}] ${style.bold(check.id)} ${style.dim(check.detail)}`);
    }
    out.push('');
    out.push(report.ok ? style.green('  All checks passed.') : style.red(`  ${report.failures} check(s) failed.`));
    await output(out.join('\n'), options);
    return report.ok ? 0 : 1;
  },

  async lint(positionals, options) {
    const text = positionals[0] === undefined ? await readInput('-') : await readInput(positionals[0]);
    const review = reviewPrompt(text, { token: str(options.token) });
    if (options.json) return output(asJson(review), options).then(() => 0);
    const out = [heading('Instruction review'), `  ${review.ok ? style.green('acceptable') : style.red('blocked')} - ${review.summary}`];
    for (const finding of review.findings) {
      out.push(bullet(`${severityColour(finding.severity)} ${style.bold(finding.id)} ${finding.message}`));
      out.push(style.dim(wrapText(finding.advice, 78, 6)));
    }
    await output(out.join('\n'), options);
    return review.ok ? 0 : 1;
  },

  async notice(positionals, options) {
    const registry = await store.loadRegistry();
    const record = findById(registry, positionals[0]);
    if (!record) throw new UserError(`no marker with id "${positionals[0]}" in the registry`);
    await output(noticeText(record), options);
    return 0;
  },
};

function severityColour(severity) {
  return { block: style.red('[block]'), warn: style.yellow('[warn] '), info: style.dim('[info] ') }[severity] || '';
}

const str = (value) => (typeof value === 'string' ? value : undefined);

async function main() {
  const [, , command, ...rest] = process.argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (command === '--version' || command === 'version') {
    process.stdout.write('carbonite 1.0.0\n');
    return 0;
  }
  const handler = commands[command];
  if (!handler) {
    process.stderr.write(`${style.red(`unknown command "${command}"`)}\n${USAGE}\n`);
    return 64;
  }
  const { options, positionals } = parseArgs(rest);
  return handler(positionals, options);
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    if (error instanceof UserError) {
      process.stderr.write(`${style.red('error')} ${error.message}\n`);
      process.exit(64);
    }
    process.stderr.write(`${style.red('error')} ${error.message}\n`);
    if (process.env.CARBONITE_DEBUG) process.stderr.write(`${error.stack}\n`);
    process.exit(70);
  });
