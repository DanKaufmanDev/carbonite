/**
 * Terminal rendering for reports. Colour only when stdout is a TTY, so piping
 * to a file or a grader's mailbox stays plain text.
 */
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (text) => (useColour ? `\x1b[${code}m${text}\x1b[0m` : String(text));

export const style = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
};

const STATUS = {
  pass: () => style.green('  ok  '),
  warn: () => style.yellow(' warn '),
  fail: () => style.red(' fail '),
};

export function heading(text) {
  return `\n${style.bold(text)}\n${style.dim('-'.repeat(Math.min(72, text.length + 8)))}`;
}

export function bullet(text, indent = 2) {
  return `${' '.repeat(indent)}- ${text}`;
}

/** Wrap to `width`, indenting every line by `indent`. */
export function wrapText(text, width = 78, indent = 4) {
  const pad = ' '.repeat(indent);
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + word).length + 1 > width - indent) {
      if (line) lines.push(pad + line.trim());
      line = '';
    }
    line += `${word} `;
  }
  if (line.trim()) lines.push(pad + line.trim());
  return lines.join('\n');
}

/** A bullet whose continuation lines line up under its text, not its marker. */
export function hanging(text, indent = 2, width = 78) {
  const wrapped = wrapText(text, width, indent + 2).trimStart();
  const [first, ...rest] = wrapped.split('\n');
  return [`${' '.repeat(indent)}- ${first}`, ...rest].join('\n');
}

export function renderChecks(checks) {
  return checks.map((check) => {
    const head = `[${STATUS[check.status]()}] ${style.bold(check.id)} - ${check.detail}`;
    return check.advice ? `${head}\n${style.dim(wrapText(check.advice, 78, 9))}` : head;
  }).join('\n');
}

export function renderAudit(report) {
  const colour = { ready: style.green, 'ready-with-cautions': style.yellow, 'not-ready': style.red }[report.verdict.code];
  const out = [
    heading('Document audit'),
    `  ${colour(style.bold(report.verdict.label))} - ${report.verdict.summary}`,
    '',
    renderChecks(report.checks),
  ];
  if (report.markers.length === 1) {
    const p = report.markers[0].payload;
    out.push(heading('Marker'));
    out.push(bullet(`id          ${p.id}`));
    out.push(bullet(`token       ${style.cyan(p.token)}`));
    if (p.assignment) out.push(bullet(`assignment  ${p.assignment}${p.course ? ` (${p.course})` : ''}`));
    out.push(bullet(`issued      ${new Date(p.issuedAt * 1000).toISOString().slice(0, 16).replace('T', ' ')}${p.expiresAt ? `  expires ${new Date(p.expiresAt * 1000).toISOString().slice(0, 10)}` : ''}`));
    out.push(bullet('instruction:'));
    out.push(style.dim(wrapText(p.prompt, 78, 6)));
  }
  if (report.anomalies.findings.length) {
    out.push(heading('Other hidden content'));
    out.push(report.anomalies.findings.map((f) => bullet(`${severityTag(f.severity)} ${f.detail}`)).join('\n'));
  }
  return out.join('\n');
}

export function renderVerify(report) {
  const colour = {
    'marker-echoed': style.red,
    'foreign-marker': style.yellow,
    'assignment-embedded': style.yellow,
    'marker-damaged': style.yellow,
    'anomalies-only': style.yellow,
    'no-signal': style.green,
  }[report.verdict.code] || style.bold;

  const out = [
    heading('Submission check'),
    `  ${colour(style.bold(report.verdict.label))}  ${style.dim(`(confidence: ${report.verdict.confidence}, score ${report.score})`)}`,
    wrapText(report.verdict.summary, 78, 2),
  ];

  if (report.signals.length) {
    out.push(heading('Signals'));
    for (const s of report.signals) {
      out.push(bullet(`${style.bold(s.id)} ${style.dim(`(+${s.weight})`)}`));
      out.push(wrapText(s.detail, 78, 6));
      if (s.note) out.push(style.dim(wrapText(s.note, 78, 6)));
    }
  }

  if (report.tokens.length) {
    out.push(heading('Token matches'));
    for (const t of report.tokens) {
      out.push(bullet(`${style.cyan(t.token)} x${t.count} ${style.dim(`via ${t.sources.join(', ')}`)}`));
      for (const hit of t.hits.slice(0, 3)) out.push(style.dim(wrapText(hit.context, 78, 6)));
    }
  }

  if (report.echo) {
    out.push(heading('Assignment wording in the submission'));
    out.push(bullet(`${Math.round(report.echo.containment * 100)}% of the assignment's 4-word phrases appear (similarity ${report.echo.similarity})`));
  }

  if (report.anomalies.findings.length) {
    out.push(heading('Other hidden content'));
    for (const f of report.anomalies.findings) {
      out.push(bullet(`${severityTag(f.severity)} ${f.detail}`));
      if (f.advice) out.push(style.dim(wrapText(f.advice, 78, 6)));
    }
  }

  if (report.recommendations.length) {
    out.push(heading('Next steps'));
    out.push(report.recommendations.map((r) => hanging(r)).join('\n'));
  }

  out.push(heading('Read this before acting'));
  out.push(report.caveats.map((c) => style.dim(hanging(c))).join('\n'));
  out.push('');
  out.push(style.dim(`  ${report.meta.tool} | ${report.meta.generatedAt} | sha256 ${report.meta.submissionSha256.slice(0, 16)}`));
  return out.join('\n');
}

export function severityTag(severity) {
  return { high: style.red('[high]'), medium: style.yellow('[med] '), low: style.dim('[low] ') }[severity] || '';
}

export function table(rows, columns, { max = 46 } = {}) {
  const cell = (value) => {
    const text = String(value ?? '');
    return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
  };
  const widths = columns.map((c) => Math.max(c.label.length, ...rows.map((r) => cell(c.value(r)).length)));
  const line = (cells) => `  ${cells.map((c, i) => cell(c).padEnd(widths[i])).join('  ')}`.trimEnd();
  return [
    style.bold(line(columns.map((c) => c.label))),
    style.dim(line(widths.map((w) => '-'.repeat(w)))),
    ...rows.map((r) => line(columns.map((c) => c.value(r) ?? ''))),
  ].join('\n');
}
