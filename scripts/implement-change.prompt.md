Implement the OpenSpec change `{{CHANGE}}` in this repository.

Use the `openspec-apply-change` skill (the `/opsx:apply` workflow) for
`{{CHANGE}}`: it tells you how to read the change's context files, which task is
next, and how to record progress. Follow it, with the additions below.

## Working method

Every task in `tasks.md` is written test-first ("Write failing tests, then ..."),
so work test-first: use the `superpowers:test-driven-development` skill. Write the
failing test, watch it fail for the right reason, then make it pass. Do not write
implementation ahead of a test that demands it.

Tick a task `- [x]` only when its specified behaviour is fully implemented — not
when it is partially done, stubbed, or deferred.

The project's hard rules are in `CLAUDE.md` and they bind you. In particular:
never edit `src/schema.gql` — it is generated, and a `PreToolUse` hook blocks the
edit anyway.

## Where to stop

Work through as many tasks as you can. Two boundaries:

1. Run the verification task of the close-out section (`npm run lint`,
   `npm test`, `npx tsc --noEmit`) and paste its output.
2. **Do not perform the final close-out task** — the one calling for
   `/code-review` and `/opsx:archive`. Leave its checkbox unchecked. Do not
   archive the change, and do not commit anything. A separate pass does that.

Never leave the tree with a red linter, red tests, or type errors. If you cannot
finish a task cleanly, revert that task's changes rather than ticking it.

## If you get stuck

You are running unattended — there is nobody to answer a question. The
`/opsx:apply` workflow tells you to pause and ask when a task is ambiguous,
reveals a design problem, or needs work beyond what the spec describes. Instead
of asking, and instead of guessing:

1. Leave the tree green and consistent (revert half-done work on that task).
2. Write `openspec/changes/{{CHANGE}}/BLOCKED.md` containing:
   - the task number and its text;
   - what is unclear or what the task collides with;
   - the options you considered and what each would cost;
   - what you need decided.
3. Stop. Do not continue to other tasks.

Write `BLOCKED.md` in English, like every other file in this repository outside
`docs/`.

A blocker is for a genuine decision, not for ordinary difficulty. A failing test
you can debug is not a blocker — use the `superpowers:systematic-debugging`
skill.

## Finishing this pass

Running out of room is expected and fine: this prompt is re-run until the change
is done, and `tasks.md` carries the state between runs. Just make sure that
whenever you stop, the checkboxes match reality and the tree is green.

End your reply with one line, exactly one of:

- `PASS RESULT: done` — every task complete except the close-out one
- `PASS RESULT: partial` — progress made, tasks remain
- `PASS RESULT: blocked` — you wrote `BLOCKED.md`
