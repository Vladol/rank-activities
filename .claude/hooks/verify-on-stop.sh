#!/usr/bin/env bash
# Stop: a session must not end on a red linter or red tests.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

out=$(npm run lint --silent 2>&1) || {
  node -e 'process.stdout.write(JSON.stringify({systemMessage:"oxlint is red:\n"+process.argv[1].slice(0,1500)}))' "$out"
  exit 0
}

out=$(npm test --silent 2>&1) || {
  node -e 'process.stdout.write(JSON.stringify({systemMessage:"Tests are red:\n"+process.argv[1].slice(-1500)}))' "$out"
  exit 0
}

echo '{"suppressOutput":true}'
