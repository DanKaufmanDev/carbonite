# Carbonite

A teaching tool for writing assignments that carry an invisible, AI-directed
integrity marker — and for checking what comes back.

You write two things, and they never mix:

| Sheet 1 — the assignment | Sheet 2 — the instruction |
|---|---|
| What students read. Carbonite does not change a word of it. | What an AI assistant reads if the assignment text is pasted into one. Students never see it. |

The instruction travels with the assignment as invisible Unicode characters. If
a student pastes the handout into a chatbot, the chatbot reads the instruction
and — with the default wording — tells the student the assignment is marked and
writes a marker token into its reply. If that token comes back in a submission,
you have a signal worth a conversation.

It is a signal, not a verdict. See [Limits](#limits) before you use it on anyone.

## Install

Node 20 or newer. No dependencies.

```sh
git clone https://github.com/DanKaufmanDev/carbonite.git
cd carbonite
node bin/carbonite.js doctor      # self-test
npm link                          # optional: puts `carbonite` on your PATH
```

There is also a browser version — the **Marker Desk** — with the same engine and
no server: open `web/index.html` from any static server, or build the
single-file version with `npm run build:web` and open `dist/carbonite.html`.

## Five minutes

```sh
carbonite keygen --label "Ms. Rivera"          # sign your markers (once)

carbonite mark --assignment essay2.txt \
  --title "Essay 2" --course "HIST 210" \
  --placement paragraphs --out handout.txt     # write the marked handout

carbonite audit handout.txt --original essay2.txt   # check before distributing

carbonite verify submission.txt --expect cbn_a1b2c3d4e5f6   # check what came back
```

`mark` prints the marked document to stdout (or `--out`) and the summary to
stderr, so `carbonite mark ... > handout.txt` gives you a clean file.

Every command takes `--json`.

## How it works

```
assignment text ──────────────────────────────────► marked document
                                                     ▲
AI instruction ─► payload ─► frame ─► carrier ───────┘
                  (JSON)   (CRC+HMAC)  (invisible characters)
```

**Frame.** The payload is JSON, deflated, wrapped in a versioned binary envelope
with a CRC-16 and a truncated HMAC-SHA256. The checksum means an edited marker
reads as *edited* rather than as absent; the signature means nobody can issue a
marker in your name, and a marker lifted into another document is still
traceable to the assignment it came from.

**Carriers.** Four, interchangeable:

| Carrier | Visible | Size | Screen readers | Use it for |
|---|---|---|---|---|
| `vs16` variation selectors | no | 1 char/byte | silent | the default |
| `zwj2` zero-width binary | no | 8 chars/byte | may announce | maximum editor compatibility |
| `tags` Unicode tag block | no | 1.3 chars/byte | silent | self-delimiting runs |
| `sentinel` visible `[[CBN1:…]]` | **yes** | 1.3 chars/byte | read aloud | plain-text, print, or full transparency |

**Redundancy.** Each insertion point carries a complete marker, so a student who
copies one paragraph still copies a verifiable one.

**Survival.** Carbonite measures rather than claims. `carbonite simulate
handout.txt` runs the document through normalisation, ASCII gateways, PDF-style
extraction, truncation, deliberate scrubbing and retyping, and reports what
survived:

```
transform            survives  copies  signature  what it approximates
identity             yes       3       valid      Baseline
nfkd                 yes       3       valid      The harshest normalisation in common use
bmp-only             NO        0       -          Older PDF extractors
strip-format         NO        0       -          A student who strips invisible characters
retype               NO        0       -          Retyped by hand
```

## The instruction is reviewed before it is issued

An instruction inside a marker is read by a machine acting on a student's
behalf, so Carbonite refuses to issue some of them:

- **Blocked:** sending data to a URL or address; markup that fetches a remote
  resource; extracting the AI's own configuration or a secret; asking for errors
  or fabricated sources to be introduced into the student's answer; collecting
  personal data; hostility toward the reader.
- **Warned:** wording that conceals itself from the student, refuses help
  outright, or uses prompt-injection framing.

A blocking rule can be overridden — one rule at a time, with
`--allow <rule-id>` — and the override is recorded inside the marker itself, so
the decision is visible later to whoever reads it.

`carbonite rules` lists all of them.

## Limits

Read these as part of the tool, not as a disclaimer.

- **A marker shows that assignment text reached an AI system.** It cannot show
  who did it, when, or whether your course allowed it.
- **Innocent readers trigger it.** Translation tools, screen readers, grammar
  checkers, study aids and tutors all read assignment text.
- **Absence proves nothing.** Any student who retypes the assignment, or strips
  formatting characters, leaves no trace. `carbonite verify` says so on every
  clean result, on purpose.
- **A determined student defeats it in one step.** Carbonite detects casual
  copying. It is not an adversarial system and should never be described as one.
- **Some AI systems will ignore the instruction**, and some will surface it to
  the student. Both are fine outcomes; neither is guaranteed.
- **Tell students.** [docs/POLICY.md](docs/POLICY.md) has syllabus wording, what
  to do when a marker fires, and the accessibility and data-protection questions
  worth settling before you use this on a real class.

## Commands

| | |
|---|---|
| `keygen` | create a signing key (stored in `~/.carbonite`, mode 0600) |
| `mark` | write a marked document |
| `audit` | check a marked document before handing it out |
| `verify` | check a submission |
| `inspect` | decode markers, no judgement |
| `scan` | report hidden characters of every kind, ours or not |
| `strip` | remove markers and hidden characters |
| `simulate` | measure which channels the marker survives |
| `lint` | safety-review an instruction on its own |
| `registry` | list, show or remove issued markers |
| `templates` `codecs` `placements` `rules` `channels` `transforms` | reference tables |
| `doctor` | self-test this installation |

## Library

```js
import { mark, verifySubmission, generateKey } from 'carbonite';

const key = await generateKey('Ms. Rivera');

const marked = await mark({
  assignment: { text: assignmentText, title: 'Essay 2', course: 'HIST 210' },
  prompt: { template: 'notice' },        // or { text: '…{{token}}…' }
  carrier: { codecs: ['vs16'], placement: 'paragraphs', copies: 3 },
  key,
});

const report = await verifySubmission(submission, { keys: [key], registry });
report.verdict;   // { code, label, confidence, summary }
report.signals;   // weighted evidence, each with its innocent explanation
report.caveats;   // always present, always worth reading
```

Zero dependencies, and the same modules run in Node and the browser.
[docs/DESIGN.md](docs/DESIGN.md) documents the frame format, the codec
interface, and how to add your own carrier, channel or safety rule.

## Tests

```sh
npm test          # 125 tests, including an exhaustive single-bit-flip tamper check
```

## Licence

MIT.
