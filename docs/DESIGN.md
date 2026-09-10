# Design notes

## Shape

```
             ┌──────────────┐
assignment ─►│              │
             │    inject    ├─► marked document ─► students
instruction ►│              │
             └──────┬───────┘
                    │  payload → frame → codec → placement
                    ▼
              registry (what was issued)
                    │
submission ─────────┴────► extract → verify → report
```

Every layer is replaceable in isolation:

| Module | Owns | Extend by |
|---|---|---|
| `core/codecs/*` | turning bytes into text and finding them again | `registerCodec()` |
| `core/frame` | envelope, checksum, signature | version bump |
| `core/payload` | what a marker carries | wire-key map |
| `core/placement` | where copies go | add to `STRATEGIES` |
| `core/promptGuard` | which instructions may be issued | add to `RULES` |
| `core/transforms` | how a marker is stress-tested | add to `TRANSFORMS` |
| `core/channels` | expectations per delivery channel | `registerChannel()` |
| `core/verify` | signals, weights, verdicts | `SIGNAL_WEIGHTS` |

Nothing in `src/core` touches the filesystem, the network or the DOM, so the
same modules run in Node, in a browser, and in a test.

## Frame format, version 1

```
offset  size  field
0       3     magic, ASCII "CBN"
3       1     version (1)
4       1     flags: 0x01 deflate-raw, 0x02 signed
5       2     body length, big-endian
7       n     body: canonical JSON, optionally deflated
7+n     8     truncated HMAC-SHA256 over bytes 0..7+n   (only if signed)
…       2     CRC-16/CCITT-FALSE over everything before it, big-endian
```

Design decisions worth stating:

- **The CRC is not redundant with the HMAC.** It lets a verifier distinguish
  "this was edited" from "this is not a marker" without holding any key, which
  is the difference between a useful report and a shrug.
- **The MAC is truncated to 8 bytes.** There is no signing oracle here and the
  cost of a forgery is bounded by the registry, so 64 bits buys plenty; the
  carrier cost of the other 24 bytes is not worth paying (192 characters in
  `zwj2`).
- **Canonical JSON** (sorted keys) so the same payload always produces the same
  bytes, and so a signature is stable across runtimes.
- **Wire keys are short** (`p`, `tok`, `fp`) because a zero-width carrier costs
  eight characters per byte. `payload.js` maps them to readable names at the
  edge, so nothing else in the codebase deals with two-letter keys.
- **Compression is opportunistic.** If `CompressionStream` is missing, or
  deflate makes the body bigger, the flag stays clear and the body is raw.

## Codec interface

```js
{
  id, label, description,
  visible,        // can a student see it?
  needsBaseChar,  // must a run follow a visible character?
  charsPerByte,   // carrier cost
  accessibility,  // 'silent' | 'may-announce' | 'read-aloud'
  notes,
  encode(bytes) -> string,
  scan(text)    -> [{ codec, start, end, bytes, partial? }],
}
```

`scan` returns *candidates*, never decisions. It is normal for it to return the
variation selector inside an emoji; the frame parser rejects it on the magic
bytes. Keeping the two responsibilities apart is what lets the anomaly scanner
report "there is hidden content here that is not ours" instead of silently
dropping it.

## Why complete copies instead of erasure coding

An earlier sketch split one frame across many insertion points with a
Reed–Solomon-style code, so a partial copy could still be reassembled. It was
discarded: the failure mode that actually happens is *a student copies one
paragraph*, and a complete frame per paragraph handles that with no maths, no
part headers, and a decoder anyone can re-implement in an afternoon. The cost is
size, and size is cheap in characters nobody sees.

## Verification is evidence, not a verdict

`verifySubmission` returns weighted signals rather than a boolean, and every
signal carries a `note` explaining how it can arise innocently. The verdict
codes deliberately describe *what was found*, never what the student did:

| code | what it means |
|---|---|
| `marker-echoed` | the token or the hidden instruction is in the visible submission |
| `foreign-marker` | a marker from a different assignment |
| `assignment-embedded` | the handout text, carrier and all, is inside the submission |
| `marker-damaged` | something that carried a marker was altered |
| `anomalies-only` | no marker; other hidden content present |
| `no-signal` | nothing found — explicitly *not* a clean bill of health |

Weights are a triage aid, not a probability. `token-present` scores highest
because a token cannot reach a submission except through a system that read the
marked text; `assignment-text-echoed` scores low because restating the prompt is
what students are taught to do.

## Threat model

**In scope:** a student who pastes a handout into a chatbot and pastes the reply
back. That is the behaviour the tool is built for, and it catches it well.

**Out of scope, and honestly so:**

- Retyping the assignment. Nothing survives it, by construction.
- `carbonite strip`, or any of the dozen equivalent one-liners.
- Screenshots, OCR, dictation.
- An AI system that ignores the instruction, or that surfaces it to the student.
- Any adversary who knows the tool exists and cares. This is a speed bump with
  a paper trail, not a lock.

**What the signature does defend:** issuing markers in your name, and moving a
marker into a document you did not write and claiming you did. Both matter more
than they sound, because both are how an integrity case falls apart.

## Testing

`npm test` runs 125 tests. The ones worth knowing about:

- Every codec round-trips all 256 byte values, random payloads and multiple
  copies, and finds nothing in ordinary prose or in emoji.
- Every single-bit flip in a frame is detected — all bit positions, exhaustively.
- Every placement strategy leaves the visible assignment text byte-identical.
- Every shipped instruction template passes the safety review it ships with.
- The survival matrix asserts the *failures* too: retyping and scrubbing must
  destroy an invisible marker, or the tool would be lying in its own report.
