import { fillPrompt, findPrompt, type EditOp } from "../core";

export type HandoffTarget = { scene: string } | { composition: string };
type Handoff = { target: HandoffTarget; intent: string; timeMs: number; selection: readonly string[]; range?: { startMs: number; endMs: number }; history: readonly string[]; sha?: string };
const posixQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const powershellQuote = (value: string) => `'${value.replace(/['\u2018-\u201b]/g, quote => quote + quote)}'`;
const milliseconds = (value: number) => `${Number(value.toFixed(3))} ms`;

export function editorHandoff({ target, intent, timeMs, selection, range, history, sha }: Handoff): string {
  const scene = "scene" in target;
  const id = scene ? target.scene : target.composition;
  return fillPrompt(findPrompt("edit-with-agent")!, {
    target: `${scene ? "scene" : "composition"} ${JSON.stringify(id)}`,
    intent: intent.trim(), playhead: milliseconds(timeMs), selection: selection.join(", ") || "none",
    range: range ? `${milliseconds(range.startMs)} to ${milliseconds(range.endMs)}` : "none",
    history: history.slice(-5).join(" | ") || "none", revision: sha ?? "read the current source before editing",
    workflow: scene
      ? `Read the tracks and SHA with velora edit ls --scene ${posixQuote(id)} --json. Preview the ops with velora edit apply --scene ${posixQuote(id)} --ops ops.json --json.`
      : `Preview the ops and read the SHA with velora compose edit --composition ${posixQuote(id)} --ops ops.json --json.`,
  });
}

export function editBatchCommand(target: HandoffTarget, ops: readonly EditOp[], sha?: string) {
  const scene = "scene" in target;
  const id = scene ? target.scene : target.composition;
  const command = scene ? "npx velora edit apply --scene" : "npx velora compose edit --composition";
  const json = JSON.stringify(ops);
  const flags = `--ops - --write${sha ? ` --expect-sha ${sha}` : ""}`;
  return {
    posix: `${command} ${posixQuote(id)} ${flags} <<'VELORA_OPS'\n${json}\nVELORA_OPS`,
    powershell: `& {\n  $OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n  ${powershellQuote(json)} | ${command} ${powershellQuote(id)} ${flags}\n}`,
  };
}

export function commandForPlatform(command: ReturnType<typeof editBatchCommand>, userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent) {
  return /Windows/i.test(userAgent) ? command.powershell : command.posix;
}
