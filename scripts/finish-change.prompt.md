Close out the OpenSpec change `{{CHANGE}}`. Its tasks are implemented and the
tree is green; what remains is review and archiving.

## 1. Review

Run the `code-review` skill at level `high` over the working tree.

Judge every finding. A finding is **blocking** if it means the change does not do
what its spec says, breaks an invariant named in `CLAUDE.md` or in the change's
`design.md`, or leaves a defect a reader would call a bug. Style preferences,
possible future refactors and "consider also" notes are not blocking.

If there is at least one blocking finding:

- Write `openspec/changes/{{CHANGE}}/REVIEW.md`: each blocking finding with its
  file, line, what is wrong and what it would take to fix. List the non-blocking
  ones separately and briefly.
- **Do not archive.** Do not fix them in this pass — the point of this file is
  that a human decides.
- End your reply with `FINISH RESULT: blocked` and stop.

## 2. Archive

Only if nothing is blocking. Use the `openspec-archive-change` skill (the
`/opsx:archive` workflow) for `{{CHANGE}}`. It moves the change under
`openspec/changes/archive/` and merges its delta specs into `openspec/specs/`;
do not do that by hand and do not shortcut it with a bare `openspec archive`.

Then confirm `openspec validate --all` is green.

## 3. Propose a commit message

Do not run any `git` command — a script commits after you.

Write the commit subject to `logs/queue/{{CHANGE}}.commitmsg`, and nothing else
in that file.

**One line. One sentence. Imperative mood, capitalised. No body, no bullet list,
no trailing paragraph.** It names the capability the change delivered, not the
work done to it. The repository's history is the pattern to match:

```
Add recorded Open-Meteo sources: 21 live-captured fixtures behind the weather ports, rebased onto today, with no network in the test suite.
Add weather source contract
SDD openspec features
Create development ecosystem
Init tech stack with node and graphql
```

A bare capability name and a fuller sentence naming what landed are both in
keeping; a multi-line message never is. Run `git log --format=%s -6` and match
what you see. For a change adding the activity declaration model, `Add activity
declaration model` is right, and three paragraphs about the scoring engine are
wrong.

End your reply with `FINISH RESULT: archived`.
