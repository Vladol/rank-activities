#!/usr/bin/env bash
# PostToolUse (Write|Edit): run oxlint on the changed file under src/**.ts.
# Feedback lands immediately instead of ten edits later.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

file=$(node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    const d = JSON.parse(raw || "{}");
    process.stdout.write(d.tool_response?.filePath ?? d.tool_input?.file_path ?? "");
  } catch {
    process.stdout.write("");
  }
});') || exit 0

case "$file" in
  *"/src/"*.ts|src/*.ts) ;;
  *) exit 0 ;;
esac

./node_modules/.bin/oxlint "$file" 2>&1 || true
exit 0
