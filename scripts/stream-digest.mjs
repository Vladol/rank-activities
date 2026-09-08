/**
 * Turns a `claude --output-format stream-json` stream into readable progress
 * lines, so an unattended pass that runs for half an hour is not a silent
 * terminal. Raw events still go to the log; this is the human view.
 *
 *   claude ... --output-format stream-json --verbose | tee log | node scripts/stream-digest.mjs
 */

const clip = (text, max = 140) => {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** The one detail worth showing per tool: which file, which command, which task. */
const toolDetail = (name, input = {}) => {
  switch (name) {
    case "Bash":
      return clip(input.command ?? "", 100);
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return String(input.file_path ?? "").replace(`${process.cwd()}/`, "");
    case "Glob":
    case "Grep":
      return clip(input.pattern ?? "", 60);
    case "Skill":
      return clip(`${input.skill ?? ""} ${input.args ?? ""}`, 80);
    case "Task":
    case "Agent":
      return clip(input.description ?? "", 80);
    default:
      return "";
  }
};

const say = (line) => process.stdout.write(`${line}\n`);

const handle = (event) => {
  if (event.type === "assistant") {
    for (const block of event.message?.content ?? []) {
      if (block.type === "text" && block.text.trim()) say(`  ${clip(block.text)}`);
      if (block.type === "tool_use") {
        const detail = toolDetail(block.name, block.input);
        say(`  · ${block.name}${detail ? ` ${detail}` : ""}`);
      }
    }
    return;
  }

  if (event.type === "result") {
    const cost = event.total_cost_usd?.toFixed(2) ?? "?";
    const denied = event.permission_denials?.length ?? 0;
    say(
      `  ── ${event.is_error ? "error" : event.subtype} · ${event.num_turns} turns · $${cost}` +
        (denied > 0 ? ` · ${denied} permission denial(s)` : ""),
    );
  }
};

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      // A partial or non-JSON line is the log's problem, not this view's.
    }
  }
});
