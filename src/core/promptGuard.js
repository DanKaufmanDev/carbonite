/**
 * Safety review of the AI-directed instruction.
 *
 * A marker is read by a machine acting on a student's behalf, so the wording is
 * not a private note — it is an instruction that may change what a student
 * receives. This module refuses the instructions that could hurt someone, warns
 * about the ones that are merely questionable, and leaves everything else
 * alone. Blocking findings can be overridden, but only per rule and the
 * override is recorded in the marker itself.
 */

const RULES = [
  {
    id: 'exfiltration',
    severity: 'block',
    test: /(send|post|upload|transmit|report|forward|submit|email|report back)[^.\n]{0,40}(to\s+)?(https?:\/\/|www\.|[\w.-]+@[\w.-]+\.\w+)/i,
    message: 'Asks the AI to send data to an outside address.',
    advice: 'A marker must not move a student\'s work or identity anywhere. Detection happens in the submission you already receive.',
  },
  {
    id: 'exfiltration-markup',
    severity: 'block',
    test: /!\[[^\]]*\]\(\s*https?:\/\/|<img[^>]+src\s*=|fetch\s*\(|curl\s+https?:|xhr\b/i,
    message: 'Contains markup or code that would fetch a remote URL.',
    advice: 'Rendered by a chat client, this becomes a silent request that leaks the conversation. Remove it.',
  },
  {
    id: 'credential-harvest',
    severity: 'block',
    // An extraction verb aimed at the assistant's own context, or any mention of
    // a secret. "Ignore all previous instructions" alone is injection framing,
    // not harvesting, and is handled by its own rule below.
    test: /(reveal|repeat|print|show|output|disclose|summari[sz]e|dump|tell (me|us))[^.\n]{0,40}(system prompt|previous instructions|prior instructions|conversation history|chat history|your (instructions|rules|prompt))|(api[_ ]?key|password|credential|access token|secret key)/i,
    message: 'Tries to extract the AI system\'s own configuration or a secret.',
    advice: 'This is a prompt-injection attack, not an integrity marker. It also breaks the AI vendor\'s terms.',
  },
  {
    id: 'sabotage',
    severity: 'block',
    test: /(introduce|insert|add|include|produce|generate|give)[^.\n]{0,50}(error|mistake|inaccura|falsehood|wrong answer|incorrect answer|fake (citation|source|reference)|fabricat)/i,
    message: 'Asks the AI to degrade the answer the student receives.',
    advice: 'Trap answers punish the student who asked a legitimate question — a tutor, a translator, an accessibility tool. Mark the work; do not poison it.',
  },
  {
    id: 'fabricated-sources',
    severity: 'block',
    test: /(cite|reference|quote)[^.\n]{0,40}(non-?existent|fictional|made-?up|invented|fake)/i,
    message: 'Asks the AI to invent sources.',
    advice: 'Fabricated citations are indistinguishable from an honest mistake at a hearing, and they mislead students who never intended to cheat.',
  },
  {
    id: 'personal-data',
    severity: 'block',
    test: /(ask|request|collect|obtain|get)[^.\n]{0,40}(student(?:'s)? (id|number|name|email)|home address|phone number|date of birth|social security|national insurance)/i,
    message: 'Asks the AI to collect personal information from the student.',
    advice: 'Student data collected this way sits in a third-party chat log outside your institution\'s control.',
  },
  {
    id: 'abusive-output',
    severity: 'block',
    test: /(insult|demean|humiliate|threaten|harass|mock|shame|scold)\b/i,
    message: 'Directs the AI to be hostile toward the reader.',
    advice: 'The reader may be a student with a disability, a parent, or a colleague. Keep the tone neutral.',
  },
  {
    id: 'self-concealment',
    severity: 'warn',
    test: /(do not|don't|never|without)[^.\n]{0,30}(mention|reveal|disclose|tell|show|inform|say)/i,
    message: 'Asks the AI to conceal the instruction from the person reading it.',
    advice: 'Concealment is what makes a marker hard to defend. A marker that says "this assignment is marked" catches the same behaviour and survives an appeal.',
  },
  {
    id: 'refusal',
    severity: 'warn',
    test: /(refuse|decline|do not (help|assist|answer|respond)|don't (help|assist|answer))/i,
    message: 'Asks the AI to withhold help.',
    advice: 'Legitimate readers get caught by this: translation, dyslexia support, a parent explaining the task. Prefer redirecting to tutoring over a flat refusal.',
  },
  {
    id: 'injection-framing',
    severity: 'warn',
    test: /(ignore (all )?(previous|prior|above)|disregard (all )?(previous|prior)|you are now|developer mode|jailbreak)/i,
    message: 'Uses prompt-injection phrasing.',
    advice: 'Injection framing is what safety filters are trained to drop, so it makes the marker less reliable, not more.',
  },
  {
    id: 'no-token',
    severity: 'info',
    test: null,
    message: 'The instruction never asks for the marker token.',
    advice: 'Without a token in the reply there is nothing observable in the submission. Add {{token}} to the wording.',
    check: (prompt, ctx) => Boolean(ctx.token) && !prompt.includes(ctx.token) && !/\{\{\s*token\s*\}\}/.test(prompt),
  },
  {
    id: 'not-self-describing',
    severity: 'info',
    test: null,
    message: 'The instruction does not say what it is or who it came from.',
    advice: 'One sentence of context ("this is a course integrity marker") makes the marker defensible and helps an AI comply instead of ignoring it.',
    check: (prompt) => !/(integrity|instructor|teacher|course|assignment|academic)/i.test(prompt),
  },
  {
    id: 'very-long',
    severity: 'info',
    test: null,
    message: 'The instruction is long.',
    advice: 'Long markers bloat the carrier and are more likely to be truncated or ignored. Two or three sentences is plenty.',
    check: (prompt) => prompt.length > 700,
  },
];

export function listRules() {
  return RULES.map(({ id, severity, message, advice }) => ({ id, severity, message, advice }));
}

/**
 * @param {string} prompt
 * @param {{token?: string, allow?: string[]}} context  rule ids in `allow` are
 *   downgraded to acknowledged findings rather than blockers.
 */
export function reviewPrompt(prompt, context = {}) {
  const text = String(prompt ?? '');
  const allow = new Set(context.allow || []);
  const findings = [];

  if (text.trim() === '') {
    findings.push({
      id: 'empty', severity: 'block', message: 'The instruction is empty.',
      advice: 'A marker with no instruction still identifies the document, but nothing will show up in an AI reply.',
      acknowledged: false,
    });
  }

  for (const rule of RULES) {
    const hit = rule.test ? rule.test.exec(text) : null;
    const matched = rule.check ? rule.check(text, context) : Boolean(hit);
    if (!matched) continue;
    findings.push({
      id: rule.id,
      severity: rule.severity,
      message: rule.message,
      advice: rule.advice,
      match: hit ? hit[0].slice(0, 120) : undefined,
      acknowledged: allow.has(rule.id),
    });
  }

  const blocking = findings.filter((f) => f.severity === 'block' && !f.acknowledged);
  return {
    ok: blocking.length === 0,
    blocking,
    findings,
    acknowledged: findings.filter((f) => f.acknowledged).map((f) => f.id),
    summary: summarise(findings, blocking),
  };
}

function summarise(findings, blocking) {
  if (findings.length === 0) return 'No concerns.';
  if (blocking.length) return `${blocking.length} blocking issue(s) — this instruction will not be issued as written.`;
  const warns = findings.filter((f) => f.severity === 'warn').length;
  if (warns) return `${warns} caution(s). Review the wording, then issue if you are satisfied.`;
  return `${findings.length} suggestion(s).`;
}
