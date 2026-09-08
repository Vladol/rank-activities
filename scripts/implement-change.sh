#!/usr/bin/env bash
#
# Drives the OpenSpec implementation queue, one change at a time.
#
# A change is too large for a single unattended session, so this runs `claude`
# repeatedly against the same change: the state lives in the checkboxes of the
# change's tasks.md, not in a conversation, which makes a pass interruptible and
# the whole run resumable.
#
#   ./scripts/implement-change.sh            # next unfinished change in the queue
#   ./scripts/implement-change.sh --change <name>
#   ./scripts/implement-change.sh --list
#   ./scripts/implement-change.sh --finish [name]   # review, archive, commit
#
# Environment: MAX_PASSES (default 6), MAX_BUDGET_USD (per pass), CLAUDE_MODEL.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

QUEUE_FILE="openspec/queue.txt"
LOG_DIR="logs/queue"
MAX_PASSES="${MAX_PASSES:-6}"
CLAUDE_MODEL="${CLAUDE_MODEL:-opus}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '%s\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; }

# --- reading state -----------------------------------------------------------

queue() {
  [ -f "$QUEUE_FILE" ] || { fail "missing $QUEUE_FILE"; exit 1; }
  sed 's/#.*//' "$QUEUE_FILE" | awk 'NF { print $1 }'
}

# Task counts come from the CLI, not from grepping checkboxes: it is the thing
# that knows which lines of tasks.md are tasks. Prints "complete total remaining".
progress() {
  local change="$1" json
  json="$(openspec instructions apply --change "$change" --json 2>/dev/null)" || return 1
  printf '%s' "$json" | node -e '
    let raw = "";
    process.stdin.on("data", (d) => (raw += d)).on("end", () => {
      const start = raw.indexOf("{");
      if (start < 0) process.exit(1);
      try {
        // No progress object means the CLI reported a problem rather than a
        // task count. Failing here matters: treating it as "0 remaining" would
        // read as a finished change and wave an unimplemented one through.
        const p = JSON.parse(raw.slice(start)).progress;
        if (!p || typeof p.remaining !== "number") process.exit(1);
        process.stdout.write(`${p.complete} ${p.total} ${p.remaining}`);
      } catch {
        process.exit(1);
      }
    });'
}

remaining_of() {
  local counts
  counts="$(progress "$1")" || return 1
  printf '%s' "$counts" | awk '{ print $3 }'
}

is_active() { [ -d "openspec/changes/$1" ]; }

next_change() {
  local change remaining
  while read -r change; do
    is_active "$change" || continue
    remaining="$(remaining_of "$change")" || continue
    [ "$remaining" -gt 0 ] && { printf '%s' "$change"; return 0; }
  done < <(queue)
  return 1
}

# The last unfinished change is the one to close out, even at 0 remaining.
finish_target() {
  local change remaining
  while read -r change; do
    is_active "$change" || continue
    remaining="$(remaining_of "$change")" || continue
    printf '%s' "$change"
    return 0
  done < <(queue)
  return 1
}

render_prompt() {
  sed "s/{{CHANGE}}/$1/g" "$2"
}

# --- running claude ----------------------------------------------------------

run_claude() {
  local prompt="$1" log="$2" status
  local -a budget=()
  [ -n "${MAX_BUDGET_USD:-}" ] && budget=(--max-budget-usd "$MAX_BUDGET_USD")

  claude -p "$prompt" \
    --permission-mode acceptEdits \
    --permission-prompts none \
    --output-format stream-json --verbose \
    --model "$CLAUDE_MODEL" \
    --effort high \
    "${budget[@]}" \
    2>>"$log.err" | tee "$log" | node scripts/stream-digest.mjs

  # The head of the pipeline is what matters: a claude that died on a rate limit
  # or a bad flag would otherwise read downstream as "the pass closed no task".
  status="${PIPESTATUS[0]}"
  if [ "$status" -ne 0 ]; then
    fail "claude exited $status — see $log.err"
    tail -n 5 "$log.err" 2>/dev/null
    return "$status"
  fi
}

# Reports what the run's final result event says. Prints denied tool names, which
# is how an allow-list gap shows itself instead of looking like a lazy model.
report_denials() {
  local log="$1"
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      let event;
      try { event = JSON.parse(lines[i]); } catch { continue; }
      if (event.type !== "result") continue;
      for (const d of event.permission_denials ?? []) {
        process.stdout.write(`  denied: ${d.tool_name ?? "?"} ${JSON.stringify(d.tool_input ?? {}).slice(0, 120)}\n`);
      }
      if (event.is_error) process.stdout.write(`  run reported an error: ${event.subtype ?? ""}\n`);
      break;
    }' "$log" 2>/dev/null
}

gate() {
  bold "Gate: lint, tests, types"
  npm run lint --silent || { fail "oxlint is red"; return 1; }
  npm test --silent || { fail "tests are red"; return 1; }
  npx tsc --noEmit || { fail "type errors"; return 1; }
  info "green"
}

# --- modes -------------------------------------------------------------------

cmd_list() {
  local change counts
  bold "Implementation queue ($QUEUE_FILE)"
  while read -r change; do
    if ! is_active "$change"; then
      printf '  %-40s archived\n' "$change"
      continue
    fi
    if counts="$(progress "$change")"; then
      printf '  %-40s %s/%s\n' "$change" "$(echo "$counts" | awk '{print $1}')" \
        "$(echo "$counts" | awk '{print $2}')"
    else
      printf '  %-40s (no task data)\n' "$change"
    fi
  done < <(queue)
}

# --finish commits with `git add -A`, so anything already uncommitted when a
# change starts would land in that change's commit. Start clean instead.
require_clean_tree() {
  [ -n "${ALLOW_DIRTY:-}" ] && return 0
  [ -z "$(git status --porcelain)" ] && return 0
  fail "The working tree is dirty. Commit or stash first — otherwise this change's"
  fail "commit would swallow the unrelated work below. ALLOW_DIRTY=1 overrides."
  info ""
  git status --short
  exit 1
}

cmd_implement() {
  local change="$1" before after pass=0 log

  is_active "$change" || { fail "$change is not an active change"; exit 1; }
  require_clean_tree
  if [ -f "openspec/changes/$change/BLOCKED.md" ]; then
    fail "BLOCKED: $change — openspec/changes/$change/BLOCKED.md is still there."
    fail "Answer it and delete the file before running again."
    exit 2
  fi

  mkdir -p "$LOG_DIR"
  local prompt
  prompt="$(render_prompt "$change" scripts/implement-change.prompt.md)"

  while [ "$pass" -lt "$MAX_PASSES" ]; do
    pass=$((pass + 1))
    before="$(remaining_of "$change")" || { fail "cannot read progress for $change"; exit 1; }
    [ "$before" -eq 0 ] && break

    log="$LOG_DIR/$change-pass$pass.jsonl"
    bold "── $change · pass $pass/$MAX_PASSES · $before tasks remaining"
    run_claude "$prompt" "$log" || exit 10
    report_denials "$log"

    if [ -f "openspec/changes/$change/BLOCKED.md" ]; then
      fail "BLOCKED: $change"
      info ""
      cat "openspec/changes/$change/BLOCKED.md"
      exit 2
    fi

    after="$(remaining_of "$change")" || { fail "cannot read progress for $change"; exit 1; }
    if [ "$after" -eq "$before" ]; then
      fail "NO PROGRESS: pass $pass closed no task. Stopping rather than burning passes."
      fail "See $log"
      exit 3
    fi
    info "  $((before - after)) task(s) closed, $after remaining"
  done

  after="$(remaining_of "$change")"
  gate || exit 4

  if [ "$after" -gt 0 ]; then
    fail "OUT OF PASSES: $change still has $after task(s). Run again to continue."
    exit 5
  fi

  info ""
  bold "READY FOR REVIEW: $change"
  info "  git diff --stat        # what changed"
  info "  ./scripts/implement-change.sh --finish"
}

cmd_finish() {
  local change="$1" log msg

  is_active "$change" || { fail "$change is not an active change"; exit 1; }
  rm -f "openspec/changes/$change/REVIEW.md"

  local remaining
  remaining="$(remaining_of "$change")" || { fail "cannot read progress for $change"; exit 1; }
  # One task may legitimately remain: the close-out task the implementation pass
  # is told not to run.
  if [ "$remaining" -gt 1 ]; then
    fail "$change still has $remaining unfinished tasks — implement it first."
    exit 1
  fi

  gate || exit 4

  mkdir -p "$LOG_DIR"
  log="$LOG_DIR/$change-finish.jsonl"
  bold "── $change · review and archive"
  run_claude "$(render_prompt "$change" scripts/finish-change.prompt.md)" "$log" || exit 10
  report_denials "$log"

  if [ -f "openspec/changes/$change/REVIEW.md" ]; then
    fail "REVIEW FOUND BLOCKING ISSUES: $change"
    info ""
    cat "openspec/changes/$change/REVIEW.md"
    info ""
    info "Fix them, delete the file, then run --finish again."
    exit 6
  fi

  if is_active "$change"; then
    fail "$change was not archived — see $log"
    exit 7
  fi

  msg="$(head -n 1 "$LOG_DIR/$change.commitmsg" 2>/dev/null | tr -d '\r')"
  [ -n "$msg" ] || { fail "no commit message proposed in $LOG_DIR/$change.commitmsg"; exit 8; }

  git add -A || exit 9
  git commit -m "$msg" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" || exit 9

  info ""
  bold "COMMITTED: $(git log --oneline -1)"
  info "  ./scripts/implement-change.sh    # next change in the queue"
}

# --- entry point -------------------------------------------------------------

MODE="implement"
CHANGE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --list) MODE="list"; shift ;;
    --finish) MODE="finish"; shift; [ $# -gt 0 ] && [[ "$1" != --* ]] && { CHANGE="$1"; shift; } ;;
    --change) CHANGE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "unknown argument: $1"; exit 1 ;;
  esac
done

case "$MODE" in
  list) cmd_list ;;
  finish)
    [ -n "$CHANGE" ] || CHANGE="$(finish_target)" || { fail "nothing left to finish"; exit 0; }
    cmd_finish "$CHANGE"
    ;;
  implement)
    [ -n "$CHANGE" ] || CHANGE="$(next_change)" || { bold "Queue is empty — every change is archived."; exit 0; }
    cmd_implement "$CHANGE"
    ;;
esac
