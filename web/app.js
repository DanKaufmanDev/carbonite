/**
 * Carbonite Marker Desk — the teacher-facing front end.
 *
 * All of the work happens in this browser tab: no assignment text, no student
 * submission and no signing key ever leaves the page. Keys and the marker
 * register live in localStorage, which is per-browser by design — a key that
 * travelled to a server would be a key someone else could sign with.
 */
import {
  addRecord, auditDocument, emptyRegistry, extract, findById, generateKey, listChannels,
  listCodecs, listRecords, listRules, listStrategies, listTemplates, mark, recommendCodecs,
  recordFor, removeRecord, renderTemplate, reviewPrompt, sanitize, scanAnomalies, simulate,
  verifySubmission, visibleText,
} from '../src/index.js';

/* ------------------------------------------------------------------ helpers */

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false || value === null) continue;
    if (name === 'class') node.className = value;
    else if (name === 'html') node.innerHTML = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const clear = (node) => { while (node.firstChild) node.firstChild.remove(); return node; };

function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.dataset.show = 'true';
  clearTimeout(node._timer);
  node._timer = setTimeout(() => { node.dataset.show = 'false'; }, 2200);
}

async function copy(text, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} to the clipboard`);
  } catch {
    toast('This browser blocked the clipboard. Select the text and copy it by hand.');
  }
}

const store = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(`carbonite.${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(`carbonite.${key}`, JSON.stringify(value));
    } catch {
      /* private windows and blocked site data are fine; the page still works */
    }
  },
};

/* -------------------------------------------------------------------- state */

const EXAMPLE = {
  course: 'HIST 210',
  title: 'Essay 2 — Explaining the Crash',
  teacher: 'Ms. Rivera',
  contact: 'rivera@example.edu',
  assignment: [
    'HIST 210 — Essay 2: Explaining the Crash',
    '',
    "Write 700 words comparing how two historians explain the 1929 stock market crash. Galbraith and Kindleberger are the obvious pair, but any two from the reading list will do.",
    '',
    'Your essay should do three things: state each historian\'s central claim in your own words, identify the evidence each one leans on hardest, and say which explanation you find more convincing and why.',
    '',
    'Use at least three sources, cited in Chicago style. Keep quotations short and analyse them — a stack of quotations is not an argument.',
    '',
    'Due Friday at 5pm, submitted as a PDF through the course site. Bring a printed outline to Thursday\'s workshop.',
  ].join('\n'),
};

const state = {
  keys: store.read('keys', []),
  activeKid: store.read('activeKid', null),
  registry: store.read('registry', emptyRegistry()),
  codecs: new Set(['vs16']),
  issue: null,
  reveal: false,
};

const activeKey = () => state.keys.find((k) => k.kid === state.activeKid) || state.keys[state.keys.length - 1] || null;

/* ------------------------------------------------------------------- compose */

function fillSelect(select, items, { value, label, selected } = {}) {
  clear(select);
  for (const item of items) {
    const option = el('option', { value: value ? value(item) : item }, label ? label(item) : item);
    if (selected && selected(item)) option.selected = true;
    select.append(option);
  }
}

function currentVars() {
  return {
    token: state.issue?.token || 'amber-slate-42',
    course: $('f-course').value.trim(),
    teacher: $('f-teacher').value.trim(),
    assignment: $('f-title').value.trim(),
    contact: $('f-contact').value.trim(),
  };
}

function applyTemplate() {
  const id = $('f-template').value;
  const template = listTemplates().find((t) => t.id === id);
  $('f-prompt').value = renderTemplate(id, { ...currentVars(), token: '{{token}}' });
  const note = $('template-note');
  clear(note);
  note.append(template.summary);
  if (template.caution) {
    note.append(el('span', { class: 'pill warn', style: 'margin-left:8px' }, 'needs a decision'));
    note.append(el('span', { style: 'display:block;margin-top:4px' }, template.caution));
  }
  renderReview();
}

function renderReview() {
  const review = reviewPrompt($('f-prompt').value.replace(/\{\{\s*token\s*\}\}/g, currentVars().token), {
    token: currentVars().token,
  });
  const box = clear($('review'));
  const tone = { block: 'stop', warn: 'warn', info: 'mute' };
  box.append(el('div', { class: `pill ${review.ok ? 'ok' : 'stop'}`, style: 'align-self:flex-start' },
    review.ok ? 'Safety review passed' : 'Blocked'));
  for (const finding of review.findings) {
    box.append(el('div', { class: 'signal', style: 'padding:8px 0' },
      el('h4', {}, el('span', { class: `pill ${tone[finding.severity]}`, style: 'margin-right:8px' }, finding.severity), finding.id),
      el('p', {}, finding.message),
      el('p', { class: 'why' }, finding.advice)));
  }
  $('btn-issue').disabled = !review.ok;
  $('issue-note').textContent = review.ok ? '' : 'Fix the blocking issue above first.';
  return review;
}

function renderCodecChecks() {
  const box = clear($('codec-checks'));
  for (const codec of listCodecs()) {
    const input = el('input', {
      type: 'checkbox',
      id: `codec-${codec.id}`,
      checked: state.codecs.has(codec.id),
      onchange: (event) => {
        if (event.target.checked) state.codecs.add(codec.id);
        else state.codecs.delete(codec.id);
        if (state.codecs.size === 0) {
          state.codecs.add('vs16');
          renderCodecChecks();
        }
        renderCodecNote();
      },
    });
    box.append(el('label', { for: `codec-${codec.id}` }, input,
      el('span', {}, codec.label),
      el('span', { class: 'pill mute' }, codec.visible ? 'visible' : 'invisible')));
  }
  renderCodecNote();
}

function renderCodecNote() {
  const chosen = listCodecs().filter((c) => state.codecs.has(c.id));
  $('codec-note').textContent = chosen.map((c) => `${c.label}: ${c.notes}`).join('  ·  ');
}

function applyChannelRecommendation() {
  const id = $('f-channels').value;
  if (!id) return;
  const recommendation = recommendCodecs([id]);
  state.codecs = new Set(recommendation.codecs);
  renderCodecChecks();
  toast(recommendation.confident
    ? `Recommended: ${recommendation.codecs.join(' + ')}`
    : `Nothing invisible survives that channel — falling back to ${recommendation.codecs.join(', ')}`);
}

/** Make carrier characters visible, so a teacher can see where the marker sits. */
function revealed(text) {
  const fragment = document.createDocumentFragment();
  let run = '';
  let hidden = 0;
  const flushHidden = () => {
    if (hidden) fragment.append(el('span', { class: 'reveal', title: `${hidden} hidden characters` }, '·'.repeat(Math.min(hidden, 40))));
    hidden = 0;
  };
  const flushRun = () => { if (run) fragment.append(document.createTextNode(run)); run = ''; };
  for (const ch of text) {
    if (visibleText(ch) === '') {
      flushRun();
      hidden++;
    } else {
      flushHidden();
      run += ch;
    }
  }
  flushRun();
  flushHidden();
  return fragment;
}

async function issue() {
  const button = $('btn-issue');
  button.disabled = true;
  $('issue-note').textContent = 'Marking…';
  try {
    const assignment = {
      text: $('f-assignment').value,
      title: $('f-title').value.trim(),
      course: $('f-course').value.trim(),
      teacher: $('f-teacher').value.trim(),
      contact: $('f-contact').value.trim(),
    };
    if (!assignment.text.trim()) {
      $('issue-note').textContent = 'Write the assignment text first.';
      return;
    }
    const key = activeKey();
    const ttl = Number($('f-ttl').value);
    const result = await mark({
      assignment,
      prompt: { text: $('f-prompt').value },
      carrier: {
        codecs: [...state.codecs],
        placement: $('f-placement').value,
        copies: Number($('f-copies').value) || 3,
      },
      key,
      ttlDays: ttl > 0 ? ttl : undefined,
    });

    if (!result.ok) {
      $('issue-note').textContent = result.reason;
      renderReview();
      return;
    }

    state.issue = result;
    state.registry = addRecord(state.registry, await recordFor({
      payload: result.payload,
      assignmentText: assignment.text,
      promptText: result.payload.prompt,
      carrier: { codecs: [...state.codecs], placement: $('f-placement').value },
      document: result.document,
    }));
    store.write('registry', state.registry);

    const [audit, survival] = await Promise.all([
      auditDocument(result.document, { keys: state.keys, registry: state.registry, originalText: assignment.text }),
      simulate(result.document, { keys: state.keys, extract }),
    ]);
    renderOutput(result, audit, survival);
    renderRegistry();
    renderExpectOptions();
    $('issue-note').textContent = '';
  } finally {
    button.disabled = false;
  }
}

function renderOutput(result, audit, survival) {
  const box = clear($('output'));
  const verdictClass = { ready: 'clear', 'ready-with-cautions': 'watch', 'not-ready': 'echo' }[audit.verdict.code];

  box.append(el('div', { class: 'sheet' },
    el('div', { class: 'sheet-head' },
      el('div', {}, el('span', { class: 'eyebrow' }, 'Marked document'), el('h2', {}, 'Hand this out')),
      el('div', { class: 'actions' },
        el('button', { class: 'btn small', onclick: () => copy(result.document, 'Marked assignment copied') }, 'Copy marked assignment'),
        el('button', {
          class: 'btn ghost small',
          onclick: (event) => {
            state.reveal = !state.reveal;
            event.target.textContent = state.reveal ? 'Hide carriers' : 'Show where the marker sits';
            const pre = $('marked-doc');
            clear(pre).append(state.reveal ? revealed(result.document) : result.document);
          },
        }, 'Show where the marker sits'))),
    el('div', { class: 'sheet-body stack' },
      el('div', { class: 'row' },
        el('span', { class: 'token' }, el('span', { class: 'eyebrow' }, 'token'), result.token),
        el('span', { class: 'hint', style: 'flex:1 1 240px' },
          'This is the word an AI assistant is asked to write into its reply. Searching a submission for it is what the Verify tab does.')),
      el('pre', {
        id: 'marked-doc',
        class: 'quote',
        style: 'max-height:280px;overflow:auto;white-space:pre-wrap;border-left-color:var(--carbon)',
      }, result.document),
      el('dl', { class: 'stats' },
        stat('Visible characters', result.stats.assignmentChars),
        stat('Hidden characters', result.stats.hiddenChars),
        stat('Copies placed', result.stats.copies),
        stat('Marker size', `${result.frameBytes} B`),
        stat('Signature', result.payload.keyId ? result.payload.keyId : 'unsigned')),
      result.warnings.length
        ? el('div', { class: 'note' }, el('b', {}, 'Worth knowing: '), result.warnings.join(' '))
        : null,
      el('div', {},
        el('span', { class: 'eyebrow' }, 'Syllabus line'),
        el('p', { class: 'hint', style: 'margin-top:6px' }, result.suggestedNotice),
        el('button', { class: 'btn ghost small', onclick: () => copy(result.suggestedNotice, 'Notice copied') }, 'Copy notice')))));

  box.append(el('div', { class: 'sheet' },
    el('div', { class: 'sheet-head' }, el('div', {}, el('span', { class: 'eyebrow' }, 'Pre-flight'), el('h2', {}, 'Audit'))),
    el('div', { class: 'sheet-body stack' },
      el('div', { class: `verdict ${verdictClass}` },
        el('h3', {}, audit.verdict.label),
        el('p', { style: 'margin:0;flex:1 1 260px' }, audit.verdict.summary)),
      el('ul', { class: 'checklist' }, audit.checks.map((check) => el('li', { class: `check ${check.status}` },
        el('span', { class: 'mark' }, { pass: 'OK', warn: '!', fail: 'X' }[check.status]),
        el('div', {}, el('b', {}, check.id), ' — ', check.detail,
          check.advice ? el('p', {}, check.advice) : null)))),
      el('div', {},
        el('span', { class: 'eyebrow' }, 'Measured survival'),
        el('p', { class: 'hint', style: 'margin:6px 0 10px' },
          `${Math.round(survival.survivalRate * 100)}% of simulated pipelines kept a readable marker. These are approximations — confirm your real channel with one round trip.`),
        el('div', { class: 'survival' }, survival.rows.map((row) => el('span', {
          class: `surv ${row.survived ? 'yes' : 'no'}`,
          title: row.describe,
        }, row.transform)))))));
}

function stat(label, value) {
  return el('div', { class: 'stat' }, el('dt', {}, label), el('dd', {}, String(value)));
}

/* -------------------------------------------------------------------- verify */

function renderExpectOptions() {
  const records = listRecords(state.registry);
  const select = $('f-expect');
  clear(select);
  select.append(el('option', { value: '' }, 'Any marker I have issued'));
  for (const record of records) {
    select.append(el('option', { value: record.id },
      `${record.assignment || record.id}${record.course ? ` · ${record.course}` : ''} · ${record.token}`));
  }
}

async function runVerify() {
  const text = $('f-submission').value;
  if (!text.trim()) {
    toast('Paste a submission first.');
    return;
  }
  const expectId = $('f-expect').value || undefined;
  const record = expectId ? findById(state.registry, expectId) : null;
  const report = await verifySubmission(text, {
    keys: state.keys,
    registry: state.registry,
    expectId,
    assignmentText: record?.assignmentText,
  });
  renderVerifyReport(report);
}

function renderVerifyReport(report) {
  const box = clear($('verify-output'));
  const tone = {
    'marker-echoed': 'echo',
    'foreign-marker': 'watch',
    'assignment-embedded': 'watch',
    'marker-damaged': 'watch',
    'anomalies-only': 'watch',
    'no-signal': 'clear',
  }[report.verdict.code] || '';

  box.append(el('div', { class: 'sheet' },
    el('div', { class: 'sheet-head' },
      el('div', {}, el('span', { class: 'eyebrow' }, 'Result'), el('h2', {}, 'What this submission carries')),
      el('button', {
        class: 'btn ghost small',
        onclick: () => copy(JSON.stringify(report, (key, value) => (value instanceof Set ? [...value] : value), 2), 'Full report copied'),
      }, 'Copy report as JSON')),
    el('div', { class: 'sheet-body stack' },
      el('div', { class: `verdict ${tone}` },
        el('h3', {}, report.verdict.label),
        el('span', { class: 'pill mute' }, `confidence: ${report.verdict.confidence}`),
        el('p', { style: 'margin:0;flex:1 1 100%' }, report.verdict.summary)),

      report.signals.length
        ? el('div', {}, el('span', { class: 'eyebrow' }, 'Signals'),
          ...report.signals.map((signal) => el('div', { class: 'signal' },
            el('span', { class: 'weight' }, `+${signal.weight}`),
            el('h4', {}, signal.id),
            el('p', {}, signal.detail),
            signal.note ? el('p', { class: 'why' }, signal.note) : null)))
        : el('p', { class: 'hint' }, 'No marker signals of any kind.'),

      report.tokens.length
        ? el('div', {}, el('span', { class: 'eyebrow' }, 'Where the token appears'),
          ...report.tokens.map((hit) => el('div', {},
            el('p', { style: 'margin:8px 0 0' },
              el('span', { class: 'token' }, el('span', { class: 'eyebrow' }, 'token'), hit.token),
              ` ×${hit.count}`),
            ...hit.hits.slice(0, 3).map((h) => el('pre', { class: 'quote' }, h.context)))))
        : null,

      report.echo
        ? el('p', { class: 'hint' },
          `${Math.round(report.echo.containment * 100)}% of the assignment's four-word phrases appear in this submission (similarity ${report.echo.similarity}).`)
        : null,

      report.anomalies.findings.length
        ? el('div', {}, el('span', { class: 'eyebrow' }, 'Other hidden content'),
          ...report.anomalies.findings.map((finding) => el('div', { class: 'signal' },
            el('h4', {}, el('span', { class: `pill ${finding.severity === 'high' ? 'stop' : 'warn'}`, style: 'margin-right:8px' }, finding.severity), finding.type),
            el('p', {}, finding.detail),
            el('p', { class: 'why' }, finding.advice))))
        : null,

      report.recommendations.length
        ? el('div', {}, el('span', { class: 'eyebrow' }, 'Next steps'),
          el('ul', { class: 'caveats' }, report.recommendations.map((r) => el('li', {}, r))))
        : null,

      el('div', {}, el('span', { class: 'eyebrow' }, 'Read this before acting'),
        el('ul', { class: 'caveats' }, report.caveats.map((c) => el('li', {}, c)))),

      el('p', { class: 'hint mono' },
        `${report.meta.tool} · ${report.meta.generatedAt} · sha256 ${report.meta.submissionSha256.slice(0, 24)}…`))));
}

/* ------------------------------------------------------------------- toolkit */

function renderKeys() {
  const box = clear($('key-list'));
  if (!state.keys.length) {
    box.append(el('p', { class: 'hint' }, 'No key yet. Markers still work without one, but anybody could copy them into another document and they would still verify.'));
  } else {
    box.append(el('div', { class: 'scroll-x' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Use'), el('th', {}, 'Key id'), el('th', {}, 'Label'), el('th', {}, 'Created'))),
      el('tbody', {}, state.keys.map((key) => el('tr', {},
        el('td', {}, el('input', {
          type: 'radio',
          name: 'activekey',
          checked: activeKey()?.kid === key.kid,
          'aria-label': `Use key ${key.kid}`,
          onchange: () => { state.activeKid = key.kid; store.write('activeKid', key.kid); renderKeyChip(); },
        })),
        el('td', { class: 'mono' }, key.kid),
        el('td', {}, key.label || '—'),
        el('td', { class: 'mono' }, key.createdAt.slice(0, 10)))))))); 
    box.append(el('p', { class: 'hint' }, 'Keys live in this browser only. Clearing site data loses them, and a marker signed with a lost key verifies as "unknown-key" forever.'));
  }
  renderKeyChip();
}

function renderKeyChip() {
  const key = activeKey();
  $('keychip').firstChild.className = `dot${key ? '' : ' off'}`;
  $('keychip-text').textContent = key ? `signing as ${key.label || key.kid}` : 'no signing key';
}

function renderRegistry() {
  const box = clear($('registry-list'));
  const records = listRecords(state.registry);
  if (!records.length) {
    box.append(el('p', { class: 'hint' }, 'Markers you issue are listed here, with the assignment text they were cut from.'));
    return;
  }
  box.append(el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Issued'), el('th', {}, 'Assignment'), el('th', {}, 'Token'), el('th', {}, ''))),
    el('tbody', {}, records.map((record) => el('tr', {},
      el('td', { class: 'mono' }, new Date(record.issuedAt * 1000).toISOString().slice(0, 10)),
      el('td', {}, record.assignment || record.id, record.course ? el('span', { class: 'hint' }, ` ${record.course}`) : null),
      el('td', { class: 'mono' }, record.token),
      el('td', {}, el('button', {
        class: 'btn ghost small',
        onclick: () => {
          state.registry = removeRecord(state.registry, record.id);
          store.write('registry', state.registry);
          renderRegistry();
          renderExpectOptions();
        },
      }, 'Remove')))))));
}

async function runScan() {
  const text = $('f-scan').value;
  const box = clear($('scan-output'));
  if (!text.trim()) {
    box.append(el('p', { class: 'hint' }, 'Paste some text first.'));
    return;
  }
  const found = await extract(text, { keys: state.keys });
  const anomalies = scanAnomalies(text, { knownRuns: found.runs });
  box.append(el('dl', { class: 'stats' },
    stat('Characters', [...text].length),
    stat('Visible', [...visibleText(text)].length),
    stat('Carbonite markers', found.markers.length),
    stat('Damaged fragments', found.damaged.length)));
  for (const marker of found.markers) {
    box.append(el('div', { class: 'signal' },
      el('h4', {}, marker.id),
      el('p', {}, `${marker.copies} copies via ${marker.codecs.join(', ')} · signature ${marker.macStatus}`),
      el('p', { class: 'why' }, marker.payload.prompt)));
  }
  if (!anomalies.findings.length) {
    box.append(el('p', { class: 'hint' }, 'Nothing else hidden in this text.'));
  }
  for (const finding of anomalies.findings) {
    box.append(el('div', { class: 'signal' },
      el('h4', {}, el('span', { class: `pill ${finding.severity === 'high' ? 'stop' : 'warn'}`, style: 'margin-right:8px' }, finding.severity), finding.type),
      el('p', {}, finding.detail),
      el('p', { class: 'why' }, finding.advice)));
  }
}

function renderReference() {
  const box = clear($('reference'));
  box.append(section('Carriers', ['Carrier', 'Visible', 'Cost', 'Screen readers', 'Notes'],
    listCodecs().map((c) => [c.label, c.visible ? 'yes' : 'no', `${c.charsPerByte}×`, c.accessibility, c.notes])));
  box.append(section('Placement', ['Strategy', 'What it does'],
    listStrategies().map((s) => [s.label, s.describe])));
  box.append(section('Channels', ['Channel', 'vs16', 'zwj2', 'tags', 'sentinel', 'Note'],
    listChannels().map((c) => [c.label, c.expect.vs16, c.expect.zwj2, c.expect.tags, c.expect.sentinel, c.note])));
  box.append(section('Instruction safety rules', ['Rule', 'Severity', 'Why'],
    listRules().map((r) => [r.id, r.severity, `${r.message} ${r.advice}`])));
}

function section(title, headers, rows) {
  return el('div', {},
    el('span', { class: 'eyebrow' }, title),
    el('div', { class: 'scroll-x', style: 'margin-top:8px' }, el('table', {},
      el('thead', {}, el('tr', {}, headers.map((h) => el('th', {}, h)))),
      el('tbody', {}, rows.map((row) => el('tr', {}, row.map((cell, i) => el('td', { class: i === 0 ? '' : 'mono' }, cell))))))));
}

/* ----------------------------------------------------------------- start-up */

function loadExample() {
  $('f-course').value = EXAMPLE.course;
  $('f-title').value = EXAMPLE.title;
  $('f-teacher').value = EXAMPLE.teacher;
  $('f-contact').value = EXAMPLE.contact;
  $('f-assignment').value = EXAMPLE.assignment;
  $('f-template').value = 'notice';
  applyTemplate();
  updateAssignmentStats();
}

function updateAssignmentStats() {
  const text = $('f-assignment').value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  $('assignment-stats').textContent = `${words} words · ${[...text].length} characters`;
}

function selectTab(name) {
  for (const tab of ['compose', 'verify', 'toolkit']) {
    $(`tab-${tab}`).setAttribute('aria-selected', String(tab === name));
    $(`panel-${tab}`).dataset.active = String(tab === name);
  }
}

function wire() {
  for (const tab of ['compose', 'verify', 'toolkit']) {
    $(`tab-${tab}`).addEventListener('click', () => selectTab(tab));
  }

  fillSelect($('f-template'), listTemplates(), { value: (t) => t.id, label: (t) => t.label, selected: (t) => t.id === 'notice' });
  fillSelect($('f-placement'), listStrategies(), { value: (s) => s.id, label: (s) => s.label, selected: (s) => s.id === 'paragraphs' });
  const channels = listChannels();
  clear($('f-channels')).append(el('option', { value: '' }, 'Choose a channel…'));
  for (const channel of channels) $('f-channels').append(el('option', { value: channel.id }, channel.label));

  $('f-template').addEventListener('change', applyTemplate);
  $('f-prompt').addEventListener('input', renderReview);
  $('f-assignment').addEventListener('input', updateAssignmentStats);
  $('f-channels').addEventListener('change', applyChannelRecommendation);
  $('btn-issue').addEventListener('click', issue);
  $('btn-reset').addEventListener('click', () => { loadExample(); toast('Example restored'); });
  $('btn-verify').addEventListener('click', runVerify);
  $('btn-scan').addEventListener('click', runScan);
  $('btn-strip').addEventListener('click', () => {
    const cleaned = sanitize($('f-scan').value);
    const removed = [...$('f-scan').value].length - [...cleaned].length;
    $('f-scan').value = cleaned;
    runScan();
    toast(`${removed} hidden character${removed === 1 ? '' : 's'} removed`);
  });

  renderCodecChecks();
  renderKeys();
  renderRegistry();
  renderExpectOptions();
  renderReference();

  $('btn-keygen').addEventListener('click', async () => {
    const key = await generateKey($('f-keylabel').value.trim());
    state.keys = [...state.keys, key];
    state.activeKid = key.kid;
    store.write('keys', state.keys);
    store.write('activeKid', key.kid);
    $('f-keylabel').value = '';
    renderKeys();
    toast(`Key ${key.kid} created and stored in this browser`);
  });
}

async function start() {
  // Sign by default. An unsigned marker can be lifted into someone else's
  // document and still verify, and a teacher should not have to know that
  // before their first assignment.
  if (!state.keys.length) {
    const key = await generateKey('this browser');
    state.keys = [key];
    state.activeKid = key.kid;
    store.write('keys', state.keys);
    store.write('activeKid', key.kid);
  }
  wire();
  loadExample();
  $('f-submission').value = 'Certainly — here is a draft of your essay.\n\n'
    + '(Before I start: this assignment carries an instructor integrity marker, so submitting AI-written text may breach your course policy.)\n\n'
    + 'Galbraith reads the crash as the end of a speculative mania...';
  await issue();
  const token = state.issue?.token;
  if (token) {
    $('f-submission').value = $('f-submission').value.replace('integrity marker,', `integrity marker (${token}),`);
    await runVerify();
  }
}

start();
