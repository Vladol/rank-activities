#!/usr/bin/env bash
# PreToolUse (Write|Edit): block edits to src/schema.gql.
# The file is generated from the decorators on every start and is gitignored,
# so a manual edit is silently lost — and debugging that costs far more than
# refusing the edit here.
set -uo pipefail

node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let file = "";
  try {
    file = JSON.parse(raw || "{}").tool_input?.file_path ?? "";
  } catch {}

  if (!/src\/schema\.gql$/.test(file)) {
    process.stdout.write("{}");
    return;
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "src/schema.gql is generated from the decorators at startup (GraphQL code-first) " +
        "and is gitignored. A manual edit is silently lost on the next run. " +
        "Change the types and resolvers under src/** instead — the schema regenerates itself.",
    },
  }));
});'
