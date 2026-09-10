# Using this on real students

Carbonite is easy to deploy and easy to misuse. This page is the part of the
tool that is not code: what to settle before you mark a single assignment, and
what to do when a marker fires.

## 1. Tell students first

A marker that students were told about is a deterrent and holds up in an appeal.
A marker they were never told about is a trap, and in several jurisdictions and
most institutional codes it is the teacher, not the student, who has the harder
question to answer.

Put something like this in the syllabus, and say it out loud in week one:

> **Academic integrity markers.** Assignments in this course carry a hidden
> marker that identifies the assignment text. If assignment text is given to an
> AI assistant, the assistant is asked to tell you that the work is marked and
> to include a reference word in its reply. If that reference word appears in
> your submission, I will ask you about it before anything else happens. The
> marker records nothing about you — no name, no identifier, no timestamp of
> your activity. If you would prefer an unmarked copy of any assignment for
> accessibility reasons, ask me and you will get one, with no explanation
> needed and no effect on your grade.

`carbonite notice <marker-id>` prints a per-assignment line you can paste into
the handout itself.

Carbonite's default instruction template (`notice`) is written to be consistent
with that paragraph: it asks the AI to *tell the student* the work is marked.
The `covert` template does the opposite, and the tool labels it as needing a
decision for exactly that reason.

## 2. Settle the accessibility question before, not after

Invisible characters sit in the middle of assistive-technology pipelines.

- The `vs16` and `tags` carriers are silent in the screen readers we know of.
  `zwj2` uses zero-width characters that a few configurations announce or pause
  on. `carbonite audit` warns you when you have chosen a carrier that can
  announce.
- Braille displays, reading-order tools and OCR pipelines all vary.
- Some students use AI tools *as* their accommodation. A marker that asks an AI
  to refuse help (the `refusal` warning) can deny a student their
  accommodation. Prefer wording that redirects to tutoring over wording that
  withholds.

**Offer an unmarked copy on request, always, without asking why.**
`carbonite strip handout.txt` produces one.

## 3. Settle the data question

- The marker contains what you put in it: assignment title, course, your name
  and contact if you supply them, the instruction, and the token. **Never put
  student data in a marker.** The safety review blocks instructions that ask an
  AI to collect any.
- The marker travels wherever the assignment travels, including into
  third-party chat logs. Assume anything in it is public.
- The registry (`~/.carbonite/registry.json`) stores your assignment text and
  instructions. It is not encrypted. Treat it like your gradebook.
- Your signing key (`~/.carbonite/keys.json`, mode 0600) is the one secret.
  Back it up. Anyone with it can issue markers in your name; without it you
  cannot prove which markers are yours.
- The browser Marker Desk keeps keys and the register in `localStorage` and
  sends nothing anywhere. Clearing site data destroys both.

## 4. When a marker fires

`carbonite verify` returns a verdict code, a confidence, weighted signals and a
list of caveats. It never returns "guilty", because it cannot.

**Do this:**

1. **Preserve the evidence first.** Save the original submission file before
   opening it in anything. Copying text between applications can strip the
   marker you are relying on. Keep the JSON report (`--json`); it carries a
   SHA-256 of exactly what you checked and the time you checked it.
2. **Ask the student, openly, before concluding anything.** "Your submission
   contains a reference word that appears when this assignment is given to an AI
   assistant. Can you tell me how you worked on this?" Many courses permit AI
   use with disclosure; many students have used a permitted tool; some have used
   a tool they did not know was an AI.
3. **Follow your institution's process.** A Carbonite report is one piece of
   evidence for that process, not a substitute for it.

**Do not:**

- Treat a clean result as proof of honest work. It means the check found
  nothing. `verify` says so on every clean report, deliberately.
- Treat embedded handout text as misconduct. Students quote the prompt. The
  verdict for that case says "ordinary" for a reason.
- Confront a student on the strength of a `low` or `moderate` confidence score.
- Describe the marker to anyone as "AI detection". It detects that *your text*
  reached an AI system, which is a much narrower and much more defensible claim
  than detecting AI writing.

## 5. What a marker cannot do

- Identify who pasted the text, or when.
- Survive a student retyping the assignment, or running the handout through any
  tool that strips formatting characters. One command defeats it.
- Prove that a submission was written by an AI. The token shows the assignment
  reached one; the writing may still be the student's own.
- Work at all on a printed handout, unless you use the visible sentinel.

If your integrity case depends on the marker alone, you do not have a case yet.

## 6. A short checklist before a real class

- [ ] Syllabus paragraph written and delivered out loud
- [ ] Unmarked copies available on request, no questions asked
- [ ] Carrier chosen for the channel you actually use, confirmed with one real
      round trip (`carbonite simulate` approximates; your LMS is the truth)
- [ ] Signing key created and backed up
- [ ] Instruction reviewed — read what `carbonite lint` says, not just whether
      it passed
- [ ] Department or academic-integrity office told what you are doing
- [ ] You know your institution's process for what happens after a signal
