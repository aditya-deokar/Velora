import { RESOURCES } from "../core/resources";
import { FLUTE_BRAND } from "../core/branding";
import {
  CLI_COMMANDS,
  hintForCode,
  nextForCode,
  nextForIssues,
  normalizeIssue,
  type CliIssue,
  type DoctorResult,
} from "../core/cli-schema";
import { TRANSITION_CATALOG, buildTransition, describeTransition, type TransitionType } from "../core/transitions";
import { formatOnboarding, terminalWelcome, type TerminalOptions } from "./terminal";
import { executeFrameRender, executeVideoRender, executeFramesRender, executeShotRender, executeCheck, executeSceneSnapshot, executeVideoExport, probeCapturePrerequisites } from "../export/commands";
import { executeDoctorCommand, executeProjectCommand, executeAudioCommand, executeCaptionsCommand, executeSkillsCommand, executeInspectCommand, executeAssetsCommand } from "../project/commands";
import { executeRecipeCommand, type RecipeCommandResult } from "../project/recipes";
import type { ProjectResult } from "../core/project";

/** SOURCE OF TRUTH: runCli adapter.
 * WHAT: translate terminal arguments into canonical project operations and format results.
 * WHY: installation policy and side effects remain behind the project command boundary.
 * WHERE: cli/main invokes this adapter; project/commands validates and executes requests.
 * Agent-first contract: every command supports --help and --json; exit 0 on
 * success, 1 on operational failure (issues[] with stable codes+hints), 2 on
 * usage errors. No command prompts for input; --json bypasses all presentation.
 */
type Environment = { root: string; port?: string; terminal?: TerminalOptions; progress?: (text: string) => void };
type Execute = typeof executeProjectCommand;
type Doctor = (input: { url?: string }, context: { root: string }) => Promise<DoctorResult>;
type Renderer = typeof executeFrameRender;
type AudioManager = typeof executeAudioCommand;
type CaptionManager = typeof executeCaptionsCommand;
type SkillsManager = typeof executeSkillsCommand;
type InspectManager = typeof executeInspectCommand;
type AssetsManager = typeof executeAssetsCommand;
type VideoRenderer = typeof executeVideoRender;
type FramesRenderer = typeof executeFramesRender;
type ShotRenderer = typeof executeShotRender;
type CheckRunner = typeof executeCheck;
export type CliResult = { code: number; stdout: string; stderr: string };
const usage = `${FLUTE_BRAND.title} — cinematic 3D motion from your real application UI.
${FLUTE_BRAND.url}
Start with npx flute guide to learn spatial composition, camera, focus and motion.

flute --version
flute help [command]
flute guide [--json]
flute init [--adapter auto|react] [--project DIR] [--package TARBALL] [--url ORIGIN] [--no-open]
flute open [--scene ID] [--project DIR] [--url ORIGIN] [--no-open]
flute sync [--project DIR]
flute scenes [--project DIR] [--json]
flute snapshot --scene ID --url ORIGIN [--time MS] [--project DIR] [--json]
flute load [--scene ID] [--project DIR] [--json]
flute validate [--project DIR] [--composition FILE] [--json]
flute inspect [--project DIR] [--scene ID | --composition FILE] [--json]
flute assets ls [--project DIR] [--json]
flute assets check [--project DIR] [--json]
flute assets add --as SOURCE --id ID [--project DIR] [--json]
flute assets rm --id ID --yes [--project DIR] [--json]
flute export --url URL --output FILE [--fps 30|60|120] [--width N --height N] [--audio FILE] [--captions FILE] [--project DIR] [--json]
flute doctor [--project DIR] [--url ORIGIN] [--json]
flute render --composition FILE --frame N --out PNG [--url ORIGIN] [--no-cache] [--project DIR] [--json]
flute render --composition FILE --out MP4 [--parallel N] [--fps N] [--width N --height N] [--no-cache] [--no-stream] [--project DIR] [--json]
flute frames --composition FILE --out DIR [--every N | --at MS,...] [--url ORIGIN] [--project DIR] [--json]
flute shot --scene ID --time MS --out PNG [--url ORIGIN] [--project DIR] [--json]
flute check --frames DIR [--budget-ms MS] [--project DIR] [--json]
flute check --video FILE [--manifest FILE] [--budget-ms MS] [--project DIR] [--json]
flute audio ls --composition FILE [--project DIR] [--json]
flute audio check --composition FILE [--project DIR] [--json]
flute captions validate --file FILE [--project DIR] [--json]
flute captions check --composition FILE [--project DIR] [--json]
flute transitions ls [--json]
flute transitions describe --type TYPE [--json]
flute skills install --dir PATH [--agent claude|codex|cursor|generic] [--source PATH] [--json]
flute skills ls [--dir PATH] [--source PATH] [--json]
flute skills check [--dir PATH] [--source PATH] [--json]

After installing velora locally, run npx velora init (or npx flute init) in your React DOM app (React 18.2+ or 19). Next.js and Vite have automatic connections; other hosts get a portable React wrapper.
--package is optional when Flute is already installed; it accepts a local .tgz for setup.
init preserves the existing root/providers and creates FLUTE.md for your coding agent.
Add --url to initialize and open in one command.
open reuses your running dev server (APP_PORT / PORT / 5173); it never starts another server.
--no-open verifies and prints the preview URL without launching a browser.
--json prints the canonical command result for scripts.
Every command supports --help (for example: flute export --help). Commands never
prompt for input; pipes and NO_COLOR stay plain. Exit 0 on success, 1 on
operational failure (see issues[].code/hint with --json), 2 on usage errors.
`;
const commandUsage: Record<string, string> = {
  guide: "flute guide [--json]\n\nPrint the versioned authoring guide: cinematic concepts, workflow and API.\n--json prints the canonical guide document plus cliVersion and the commands[] index.",
  init: "flute init [--adapter auto|react] [--project DIR] [--package TARBALL] [--url ORIGIN] [--no-open] [--json]\n\nInitialize the project connection and create FLUTE.md for the coding agent.\n--adapter react selects the portable connection explicitly. --package accepts a local .tgz.",
  open: "flute open [--scene ID] [--project DIR] [--url ORIGIN] [--no-open] [--json]\n\nVerify the running dev server (APP_PORT / PORT / 5173) and print or open the preview URL.\n--scene ID opens that scene directly. --no-open verifies without launching a browser.",
  sync: "flute sync [--project DIR] [--json]\n\nRefresh the scene registry after adding or removing recipe/component files.",
  scenes: "flute scenes [--project DIR] [--json]\n\nList the validated scene recipes in the project catalog.",
  load: "flute load [--scene ID] [--project DIR] [--json]\n\nLoad one scene recipe source (without --scene, report project status).",
  validate: "flute validate [--project DIR] [--composition FILE] [--json]\n\nValidate the project, scene recipes and bindings; with --composition, validate that timeline plus assets, audio, captions and transitions.\nReports actionable diagnostics with stable codes.",
  inspect: "flute inspect [--project DIR] [--scene ID | --composition FILE] [--json]\n\nInspect the project, one scene or one composition file without mutating anything.\nWithout flags, report project identity plus recipe/asset counts.",
  assets: "flute assets ls [--project DIR] [--json]\nflute assets check [--project DIR] [--json]\nflute assets add --as SOURCE --id ID [--project DIR] [--json]\nflute assets rm --id ID --yes [--project DIR] [--json]\n\nManage project assets in assets/ (list, check, add a file under an ID, remove with confirmation).",
  snapshot: "flute snapshot --scene ID --url ORIGIN [--time MS] [--project DIR] [--json]\n\nCapture one frame PNG into the scene recipe at --time milliseconds (default midpoint).",
  export: "flute export --url URL --output FILE [--fps 30|60|120] [--width N --height N] [--audio FILE] [--captions FILE] [--project DIR] [--json]\n\nRender the live scene to a project-relative MP4 through the capture bridge.\n--audio mixes a project-relative audio file; --captions burns a project-relative .srt/.vtt file.\nRequires FFmpeg and Playwright Chromium; does not start the app server.",
  doctor: "flute doctor [--project DIR] [--url ORIGIN] [--json]\n\nCheck Node, npm package, React, toolkit, scene catalog, FFmpeg and Chromium.\n--url also probes dev-server reachability. Exit 0 when every check passes, 1 otherwise.",
  render: "flute render --composition FILE [--frame N | --time MS] --out PNG [--url ORIGIN] [--no-cache] [--cache-dir DIR] [--project DIR] [--json]\nflute render --composition FILE --out MP4 [--parallel 1-4] [--fps 30|60|120] [--width N --height N] [--no-cache] [--no-stream] [--project DIR] [--json]\n\nRender one exact timeline frame to PNG plus a manifest, or the whole timeline to MP4.\nFrame mode needs exactly one of --frame/--time with a .png --out; video mode needs an .mp4 --out.\n--json streams newline-delimited progress lines ending with the result envelope (--no-stream prints only the envelope).",
  frames: "flute frames --composition FILE --out DIR [--every N | --at MS,...] [--url ORIGIN] [--no-cache] [--cache-dir DIR] [--project DIR] [--json]\n\nExtract a PNG sequence plus manifest.json. Defaults to one frame per second.\nExactly one of --every (frame step) or --at (comma-separated milliseconds) may be given.",
  shot: "flute shot --scene ID --time MS --out PNG [--url ORIGIN] [--project DIR] [--json]\n\nCapture one still from a single scene without a composition.",
  check: "flute check --frames DIR [--budget-ms MS] [--project DIR] [--json]\nflute check --video FILE [--manifest FILE] [--budget-ms MS] [--project DIR] [--json]\n\nRun automated visual checks over rendered evidence (technical checks only, never artistic scores).\nExactly one of --frames or --video is required; --manifest cross-checks video records.",
  audio: "flute audio ls --composition FILE [--project DIR] [--json]\nflute audio check --composition FILE [--project DIR] [--json]\n\nList composition audio tracks with frame-snapped placement, or validate them\nagainst discovered assets (existence, type, size, codec, fades, ducking).",
  captions: "flute captions validate --file FILE [--project DIR] [--json]\nflute captions check --composition FILE [--project DIR] [--json]\n\nValidate a .srt/.vtt file, or check a composition's captions against its timeline span.",
  transitions: "flute transitions ls [--json]\nflute transitions describe --type TYPE [--json]\n\nList the entering-side transition catalog, or show one transition with example tracks.\nTransitions declare segment entrances; builders emit tracks to paste into recipe motion.",
  skills: "flute skills install --dir PATH [--agent claude|codex|cursor|generic] [--source PATH] [--json]\nflute skills ls [--dir PATH] [--source PATH] [--json]\nflute skills check [--dir PATH] [--source PATH] [--json]\n\nInstall the Velora skills library (idempotent; differing files are ERR_SKILL_CONFLICT), list available/installed skills with version drift, or check front-matter and cross-links.\n--agent prints the registration snippet for that agent without writing config files.",
};
function commandHelpText(command: string): string {
  const entry = CLI_COMMANDS.find((item) => item.name === command);
  const body = commandUsage[command] ?? usage;
  return `${FLUTE_BRAND.title}\n${FLUTE_BRAND.url}\n\n${body}\n\nSkill: ${entry?.skill ?? "velora-debug"}\nExit 0 on success, 1 on operational failure, 2 on usage errors. Add --json for machine-readable output.\n`;
}
function humanIssue(issue: CliIssue): string {
  const head = `${issue.code}${issue.path ? ` (${issue.path})` : ""}: ${issue.message}`;
  return issue.hint ? `${head}\n  Hint: ${issue.hint}` : head;
}
function withCommand<T extends { success: boolean }>(result: T, command: string): T & { command: string } {
  return { ...result, command };
}
function operationalFailure(command: string, issues: unknown[], json: boolean): CliResult {
  const normalized = (issues as unknown[]).map(normalizeIssue);
  const next = nextForIssues(normalized);
  return {
    code: 1,
    stdout: "",
    stderr: (json ? JSON.stringify({ success: false, command, issues: normalized, next }) : normalized.map(humanIssue).join("\n")) + "\n",
  };
}
function output(result: ProjectResult, json: boolean, command: string, onboarding?: { terminal?: TerminalOptions; streamed: boolean }): CliResult {
  if (!result.success) {
    const normalized = result.issues.map(normalizeIssue);
    const next = result.next ?? nextForIssues(normalized);
    return {
      code: 1,
      stdout: "",
      stderr: (json ? JSON.stringify({ success: false, command, issues: normalized, next }) : normalized.map(humanIssue).join("\n")) + "\n",
    };
  }
  if (onboarding && !json) return {code:0, stdout:formatOnboarding(result, onboarding.terminal, !onboarding.streamed), stderr:""};
  const message = result.data.url ?? (result.data.project
    ? `Project ${result.data.integration?.kind === "react" ? "connection generated" : "ready"}: ${result.data.project.entry}${result.data.changed ? " (initialized)" : ""}.\nUse your running dev server, or start it with npm run dev. Then run npx flute open --url <origin printed by your app>.`
    : "Project command completed.");
  const handoff = result.data.handoff;
  const next = handoff
    ? `\nAgent handoff: ${handoff.path}\nCopy this prompt into your coding agent (replace <page route or component path>):\n${handoff.prompt}`
    : "\nScene authoring: run npx flute guide before composing animations.";
  const warnings = result.warnings?.map(normalizeIssue);
  return {
    code: 0,
    stdout: (json
      ? JSON.stringify({ success: true, command, data: result.data, ...(warnings?.length ? { warnings } : {}), ...(result.next ? { next: result.next } : {}) })
      : `${FLUTE_BRAND.title}\n${FLUTE_BRAND.url}\n${message}${result.data.integration ? "\n" + result.data.integration.instructions : ""}${next}`) + "\n",
    stderr: !json && warnings?.length ? warnings.map(humanIssue).join("\n") + "\n" : "",
  };
}
function recipeOutput(result: RecipeCommandResult, json: boolean, command: string): CliResult {
  // Recipe diagnostics carry path/message without codes; assign the catalog
  // code here so machine consumers always receive one.
  const raw = result.success ? result.data.issues : result.issues;
  const normalized = raw.map((issue) => normalizeIssue({ code: "invalid-scene", ...issue }));
  if (!result.success) {
    const next = nextForIssues(normalized);
    return { code: 1, stdout: "", stderr: (json ? JSON.stringify({ success: false, command, issues: normalized, next }) : normalized.map(humanIssue).join("\n")) + "\n" };
  }
  const text = result.data.url ?? (result.data.selected ? JSON.stringify(result.data.selected, null, 2)
    : result.data.scenes.length ? result.data.scenes.map(scene => `${scene.id}\t${scene.title}`).join("\n")
      : "No local scenes found. Add a recipe and matching component in src/flute/scenes.");
  return {
    code: 0,
    stdout: (json ? JSON.stringify(withCommand(result, command)) : text) + "\n",
    stderr: !json && normalized.length ? normalized.map(humanIssue).join("\n") + "\n" : "",
  };
}
function humanDoctor(result: DoctorResult, unicode: boolean): string {
  const mark = (pass: boolean) => (pass ? (unicode ? "✓" : "+") : (unicode ? "✗" : "x"));
  const checks = result.data?.checks ?? [];
  const lines = checks.map((check) => `${mark(check.pass)} ${check.label}${check.detail ? `: ${check.detail}` : ""}${!check.pass && check.hint ? ` (Hint: ${check.hint})` : ""}`);
  if (result.success) return `${FLUTE_BRAND.title}\nDoctor: every check passed.\n${lines.join("\n")}`;
  const issues = result.issues.map(humanIssue).join("\n");
  return `${lines.join("\n")}\n${issues}`;
}
async function defaultDoctor(input: { url?: string }, context: { root: string }): Promise<DoctorResult> {
  try {
    const project = await executeDoctorCommand(input, context);
    const capture = await probeCapturePrerequisites();
    const checks = [...(project.data?.checks ?? [])];
    const issues = [...(project.success ? [] : project.issues)];
    checks.push({
      id: "ffmpeg", label: "FFmpeg encoder", pass: capture.ffmpeg.available, detail: capture.ffmpeg.detail,
      ...(!capture.ffmpeg.available ? { code: "ERR_FFMPEG_MISSING", hint: hintForCode("ERR_FFMPEG_MISSING") } : {}),
    });
    if (!capture.ffmpeg.available)
      issues.push(normalizeIssue({ code: "ERR_FFMPEG_MISSING", message: `FFmpeg encoder: ${capture.ffmpeg.detail}`, path: "doctor.ffmpeg" }));
    checks.push({
      id: "chromium", label: "Chromium browser", pass: capture.chromium.available, detail: capture.chromium.detail,
      ...(!capture.chromium.available ? { code: "ERR_CHROMIUM_MISSING", hint: hintForCode("ERR_CHROMIUM_MISSING") } : {}),
    });
    if (!capture.chromium.available)
      issues.push(normalizeIssue({ code: "ERR_CHROMIUM_MISSING", message: `Chromium browser: ${capture.chromium.detail}`, path: "doctor.chromium" }));
    if (!issues.length) return { success: true, command: "doctor", data: { checks } };
    return { success: false, command: "doctor", data: { checks }, issues, next: nextForIssues(issues) };
  } catch {
    const issues = [normalizeIssue({ code: "ERR_INTERNAL", message: "Doctor failed unexpectedly. Check local files and permissions, then retry." })];
    return { success: false, command: "doctor", issues, next: nextForCode("ERR_INTERNAL") };
  }
}
function humanAudio(sub: string, data: { tracks: { id: string; assetId: string; startMs: number; frame: number; gain: number }[]; placementErrorMs: number; driftBudgetMs: number }): string {
  if (sub === "ls") {
    if (!data.tracks.length) return "No audio tracks declared in this composition.";
    return data.tracks.map((t) => `${t.id}\t${t.assetId}\t${t.startMs}ms (frame ${t.frame})\tgain ${t.gain}`).join("\n");
  }
  return `Audio: ${data.tracks.length} track${data.tracks.length === 1 ? "" : "s"} valid; placement error ${data.placementErrorMs}ms within the ${data.driftBudgetMs}ms drift budget.`;
}
function humanCaptions(sub: string, data: { cues: { startMs: number; endMs: number; text: string }[]; kind: string; durationMs?: number }): string {
  if (sub === "validate") return `Captions: ${data.cues.length} cues (${data.kind}).`;
  return `Captions: ${data.cues.length} cues over ${data.durationMs}ms.`;
}
function parseMediaArgs(
  command: string, args: string[], expected: string[], allowedFor: (sub: string) => string[],
  fail: (message: string, code?: string, name?: string) => CliResult,
): { sub: string; flags: Map<string, string | true> } | { failed: CliResult } {
  const [sub, ...rest] = args;
  if (!sub || sub.startsWith("--")) return { failed: fail(`${command} requires a subcommand: ${expected.join(", ")}.`, "ERR_MISSING_VALUE", command) };
  if (!expected.includes(sub)) return { failed: fail(`Unknown ${command} subcommand: ${sub}. Expected ${expected.join(" or ")}.`, "ERR_UNKNOWN_COMMAND", command) };
  const allowed = allowedFor(sub);
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!allowed.includes(flag)) return { failed: fail(`Unknown option: ${flag}`, "ERR_UNKNOWN_OPTION", command) };
    if (flags.has(flag)) return { failed: fail(`Duplicate option: ${flag}`, "ERR_DUPLICATE_OPTION", command) };
    if (flag === "--json") flags.set(flag, true);
    else {
      const value = rest[++i];
      if (!value || value.startsWith("--")) return { failed: fail(`Missing value for ${flag}`, "ERR_MISSING_VALUE", command) };
      flags.set(flag, value);
    }
  }
  return { sub, flags };
}
// Transitions are pure catalog data: no project I/O, no manager needed.
async function runTransitionsCommand(
  args: string[],
  fail: (message: string, code?: string, name?: string) => CliResult,
): Promise<CliResult> {
  const [sub, ...rest] = args;
  if (!sub || sub.startsWith("--")) return fail("transitions requires a subcommand: ls, describe.", "ERR_MISSING_VALUE", "transitions");
  if (sub !== "ls" && sub !== "describe") return fail(`Unknown transitions subcommand: ${sub}. Expected ls or describe.`, "ERR_UNKNOWN_COMMAND", "transitions");
  const allowed = sub === "ls" ? ["--json"] : ["--type", "--json"];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!allowed.includes(flag)) return fail(`Unknown option: ${flag}`, "ERR_UNKNOWN_OPTION", "transitions");
    if (flags.has(flag)) return fail(`Duplicate option: ${flag}`, "ERR_DUPLICATE_OPTION", "transitions");
    if (flag === "--json") flags.set(flag, true);
    else {
      const value = rest[++i];
      if (!value || value.startsWith("--")) return fail(`Missing value for ${flag}`, "ERR_MISSING_VALUE", "transitions");
      flags.set(flag, value);
    }
  }
  const json = flags.has("--json");
  if (sub === "ls") {
    const result = { success: true as const, data: { transitions: TRANSITION_CATALOG } };
    return { code: 0, stdout: (json ? JSON.stringify(withCommand(result, "transitions"))
      : TRANSITION_CATALOG.map((t) => `${t.type}\t${t.description}`).join("\n")) + "\n", stderr: "" };
  }
  if (!flags.has("--type")) return fail("transitions describe requires --type.", "ERR_MISSING_VALUE", "transitions");
  const type = flags.get("--type") as string;
  const entry = TRANSITION_CATALOG.find((item) => item.type === type);
  if (!entry) return operationalFailure("transitions", [{ code: "ERR_TRANSITION_INVALID", message: `Unknown transition type "${type}". Run velora transitions ls --json for the catalog.` }], json);
  try {
    const described = describeTransition(entry.type as TransitionType);
    const built = buildTransition(entry.type as TransitionType, { surfaceIds: described.needsLeaves ? ["main"] : [], durationMs: 1000 });
    const result = { success: true as const, data: { ...described, example: { surfaceIds: described.needsLeaves ? ["main"] : [], durationMs: 1000, tracks: built.tracks, warnings: built.warnings } } };
    return { code: 0, stdout: (json ? JSON.stringify(withCommand(result, "transitions"))
      : `${described.type} — ${described.description}\nExample tracks (1000ms, Surface "main"):\n${JSON.stringify(built.tracks, null, 2)}`) + "\n", stderr: "" };
  } catch {
    return operationalFailure("transitions", [{ code: "ERR_INTERNAL", message: "Transition describe failed unexpectedly." }], json);
  }
}
async function runAudioCommand(
  args: string[], environment: Environment, audioManager: AudioManager,
  fail: (message: string, code?: string, name?: string) => CliResult,
): Promise<CliResult> {
  const parsed = parseMediaArgs("audio", args, ["ls", "check"], () => ["--composition", "--project", "--json"], fail);
  if ("failed" in parsed) return parsed.failed;
  const { sub, flags } = parsed;
  if (!flags.has("--composition")) return fail("audio requires --composition.", "ERR_MISSING_VALUE", "audio");
  const context = { root: (flags.get("--project") as string | undefined) ?? environment.root };
  const json = flags.has("--json");
  try {
    const result = await audioManager(sub === "ls" ? "list-audio" : "check-audio", { composition: flags.get("--composition") as string }, context);
    if (!result.success) return operationalFailure("audio", result.issues, json);
    return { code: 0, stdout: (json ? JSON.stringify(withCommand(result, "audio")) : humanAudio(sub, result.data)) + "\n", stderr: "" };
  } catch {
    return operationalFailure("audio", [{ code: "ERR_INTERNAL", message: "audio failed unexpectedly. Check local files and retry." }], json);
  }
}
async function runCaptionsCommand(
  args: string[], environment: Environment, captionManager: CaptionManager,
  fail: (message: string, code?: string, name?: string) => CliResult,
): Promise<CliResult> {
  const parsed = parseMediaArgs("captions", args, ["validate", "check"],
    (sub) => sub === "validate" ? ["--file", "--project", "--json"] : ["--composition", "--project", "--json"], fail);
  if ("failed" in parsed) return parsed.failed;
  const { sub, flags } = parsed;
  if (sub === "validate" && !flags.has("--file")) return fail("captions validate requires --file.", "ERR_MISSING_VALUE", "captions");
  if (sub === "check" && !flags.has("--composition")) return fail("captions check requires --composition.", "ERR_MISSING_VALUE", "captions");
  const context = { root: (flags.get("--project") as string | undefined) ?? environment.root };
  const json = flags.has("--json");
  try {
    const result = await captionManager(sub === "validate" ? "validate-captions" : "check-captions",
      sub === "validate" ? { file: flags.get("--file") as string } : { composition: flags.get("--composition") as string }, context);
    if (!result.success) return operationalFailure("captions", result.issues, json);
    return { code: 0, stdout: (json ? JSON.stringify(withCommand(result, "captions")) : humanCaptions(sub, result.data)) + "\n", stderr: "" };
  } catch {
    return operationalFailure("captions", [{ code: "ERR_INTERNAL", message: "captions failed unexpectedly. Check local files and retry." }], json);
  }
}
function humanSkills(kind: string, data: unknown): string {
  const body = data as { installed?: string[]; changed?: boolean; dir?: string; available?: { name: string }[]; drift?: unknown[]; skills?: { name: string; ok: boolean }[]; snippet?: string };
  if (kind === "install") return `Installed ${(body.installed ?? []).length} Velora skill files to ${body.dir ?? ""}${body.changed === false ? " (already current)" : ""}.${body.snippet ? `\n${body.snippet}` : ""}`;
  if (kind === "list") return `Available: ${(body.available ?? []).map((s) => s.name).join(", ") || "none"}.`;
  return `Skills check passed (${(body.skills ?? []).length} skills).`;
}
async function runSkillsCommand(
  args: string[], environment: Environment, skillsManager: SkillsManager,
  fail: (message: string, code?: string, name?: string) => CliResult,
): Promise<CliResult> {
  const parsed = parseMediaArgs("skills", args, ["install", "ls", "check"],
    (sub) => sub === "install" ? ["--dir", "--agent", "--source", "--json"] : ["--dir", "--source", "--json"], fail);
  if ("failed" in parsed) return parsed.failed;
  const { sub, flags } = parsed;
  const json = flags.has("--json");
  if (sub === "install") {
    if (!flags.has("--dir")) return fail("skills install requires --dir.", "ERR_MISSING_VALUE", "skills");
    const agent = flags.get("--agent") as string | undefined;
    if (agent && !["claude", "codex", "cursor", "generic"].includes(agent))
      return fail(`Unknown agent: ${agent}. Expected claude, codex, cursor or generic.`, "ERR_UNKNOWN_OPTION", "skills");
  }
  const context = {
    root: (flags.get("--project") as string | undefined) ?? environment.root,
    ...(environment.terminal?.version ? { version: environment.terminal.version } : {}),
  };
  try {
    const operation = sub === "install" ? "install-skills" : sub === "ls" ? "list-skills" : "check-skills";
    const input = sub === "install"
      ? { dir: flags.get("--dir") as string, ...(flags.has("--agent") ? { agent: flags.get("--agent") as string } : {}), ...(flags.has("--source") ? { source: flags.get("--source") as string } : {}) }
      : { ...(flags.has("--dir") ? { dir: flags.get("--dir") as string } : {}), ...(flags.has("--source") ? { source: flags.get("--source") as string } : {}) };
    const result = await skillsManager(operation, input, context);
    if (!result.success) {
      if (operation === "check-skills" && "data" in result && result.data) {
        const body = json ? JSON.stringify(result) : `Skills check failed.\n${result.issues.map(humanIssue).join("\n")}`;
        return { code: 1, stdout: "", stderr: `${body}\n` };
      }
      return operationalFailure("skills", result.issues, json);
    }
    const kind = (result.data as { kind: string }).kind;
    return { code: 0, stdout: (json ? JSON.stringify(withCommand(result, "skills")) : humanSkills(kind, result.data)) + "\n", stderr: "" };
  } catch {
    return operationalFailure("skills", [{ code: "ERR_INTERNAL", message: "skills failed unexpectedly. Check local files and retry." }], json);
  }
}
function humanInspect(data: unknown): string {
  const body = data as { kind: string; recipes?: { count: number; ids: string[] }; assets?: { count: number }; initialized?: boolean };
  if (body.kind === "project") return `Project ${body.initialized ? "initialized" : "not initialized"}: ${body.recipes?.count ?? 0} scenes, ${body.assets?.count ?? 0} assets.`;
  return JSON.stringify(body, null, 2);
}
async function runInspectCommand(
  args: string[], environment: Environment, inspectManager: InspectManager,
  fail: (message: string, code?: string, name?: string) => CliResult,
): Promise<CliResult> {
  const allowed = ["--project", "--scene", "--composition", "--json"];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!allowed.includes(flag)) return fail(`Unknown option: ${flag}`, "ERR_UNKNOWN_OPTION", "inspect");
    if (flags.has(flag)) return fail(`Duplicate option: ${flag}`, "ERR_DUPLICATE_OPTION", "inspect");
    if (flag === "--json") flags.set(flag, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) return fail(`Missing value for ${flag}`, "ERR_MISSING_VALUE", "inspect");
      flags.set(flag, value);
    }
  }
  if (flags.has("--scene") && flags.has("--composition"))
    return fail("Pass only one of --scene or --composition.", "ERR_INVALID_FLAG_COMBINATION", "inspect");
  const context = { root: (flags.get("--project") as string | undefined) ?? environment.root };
  const json = flags.has("--json");
  try {
    const result = await inspectManager({
      ...(flags.has("--scene") ? { sceneId: flags.get("--scene") as string } : {}),
      ...(flags.has("--composition") ? { composition: flags.get("--composition") as string } : {}),
    }, context);
    if (!result.success) return operationalFailure("inspect", result.issues, json);
    return { code: 0, stdout: (json ? JSON.stringify(withCommand(result, "inspect")) : humanInspect(result.data)) + "\n", stderr: "" };
  } catch {
    return operationalFailure("inspect", [{ code: "ERR_INTERNAL", message: "inspect failed unexpectedly. Check local files and retry." }], json);
  }
}
function humanAssets(sub: string, data: { assets: { id: string; path: string }[]; verdict?: string; removed?: { id: string; path: string } }): string {
  if (sub === "rm" && data.removed) return `Removed ${data.removed.id} (${data.removed.path}).`;
  if (sub === "check") return `Assets: ${data.assets.length} files, verdict ${data.verdict ?? "pass"}.`;
  if (!data.assets.length) return "No assets discovered.";
  return data.assets.map((a) => `${a.id}\t${a.path}`).join("\n");
}
async function runAssetsCommand(
  args: string[], environment: Environment, assetsManager: AssetsManager,
  fail: (message: string, code?: string, name?: string) => CliResult,
): Promise<CliResult> {
  const [sub, ...rest] = args;
  if (!sub || sub.startsWith("--")) return fail("assets requires a subcommand: ls, check, add, rm.", "ERR_MISSING_VALUE", "assets");
  if (!["ls", "check", "add", "rm"].includes(sub)) return fail(`Unknown assets subcommand: ${sub}. Expected ls, check, add or rm.`, "ERR_UNKNOWN_COMMAND", "assets");
  const allowed = sub === "ls" || sub === "check" ? ["--project", "--json"] : sub === "add" ? ["--as", "--id", "--project", "--json"] : ["--id", "--yes", "--project", "--json"];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!allowed.includes(flag)) return fail(`Unknown option: ${flag}`, "ERR_UNKNOWN_OPTION", "assets");
    if (flags.has(flag)) return fail(`Duplicate option: ${flag}`, "ERR_DUPLICATE_OPTION", "assets");
    if (flag === "--json" || flag === "--yes") { flags.set(flag, true); continue; }
    const value = rest[++i];
    if (!value || value.startsWith("--")) return fail(`Missing value for ${flag}`, "ERR_MISSING_VALUE", "assets");
    flags.set(flag, value);
  }
  const context = { root: (flags.get("--project") as string | undefined) ?? environment.root };
  const json = flags.has("--json");
  if (sub === "rm" && !flags.has("--yes")) return fail("assets rm requires --yes to confirm removal.", "ERR_MISSING_VALUE", "assets");
  if (sub === "add" && (!flags.has("--as") || !flags.has("--id"))) return fail("assets add requires --as SOURCE and --id ID.", "ERR_MISSING_VALUE", "assets");
  if (sub === "rm" && !flags.has("--id")) return fail("assets rm requires --id.", "ERR_MISSING_VALUE", "assets");
  try {
    const operation = sub === "ls" ? "list-assets" : sub === "check" ? "check-assets" : sub === "add" ? "add-asset" : "remove-asset";
    const input = operation === "add-asset"
      ? { source: flags.get("--as") as string, assetId: flags.get("--id") as string }
      : operation === "remove-asset"
        ? { assetId: flags.get("--id") as string, confirmed: true as const }
        : {};
    const result = await assetsManager(operation, input, context);
    if (!result.success) return operationalFailure("assets", result.issues, json);
    return { code: 0, stdout: (json ? JSON.stringify(withCommand(result, "assets")) : humanAssets(sub, result.data)) + "\n", stderr: "" };
  } catch {
    return operationalFailure("assets", [{ code: "ERR_INTERNAL", message: "assets failed unexpectedly. Check local files and retry." }], json);
  }
}
function humanCheck(checks: { id: string; pass: boolean; detail: string }[], unicode: boolean): string {
  return checks.map((check) => `${check.pass ? (unicode ? "✓" : "+") : (unicode ? "✗" : "x")} ${check.id}: ${check.detail}`).join("\n");
}
// Progress collection for long renders. --json streams newline-delimited
// progress lines ending with the result envelope; --no-stream (or human mode)
// returns only the final body. Lines stream in-band with the result because
// runCli owns no process-write contract; agents parse identical bytes either way.
function progressCollector(json: boolean, noStream: boolean): { lines: string[]; onProgress?: (done: number, total: number) => void; flush: (body: string) => string } {
  const lines: string[] = [];
  if (!json || noStream) return { lines, onProgress: undefined, flush: (body) => `${body}\n` };
  return {
    lines,
    onProgress: (done, total) => {
      lines.push(JSON.stringify({ type: "progress", phase: "capture", frame: done, total, pct: total ? Math.round((done / total) * 100) : 100 }));
    },
    flush: (body) => `${[...lines, body].join("\n")}\n`,
  };
}
function serverUrl(flags: Map<string, string | true>, environment: Environment): string {
  return (flags.get("--url") as string | undefined) ?? `http://127.0.0.1:${environment.port ?? "5173"}`;
}
function cliVersion(environment: Environment): { version: string } | Record<string, never> {
  return environment.terminal?.version ? { version: environment.terminal.version } : {};
}
export async function runCli(argv: string[], environment: Environment, execute: Execute = executeProjectCommand, exporter: typeof executeVideoExport = executeVideoExport, recipes: typeof executeRecipeCommand = executeRecipeCommand, snapshotter:typeof executeSceneSnapshot=executeSceneSnapshot, doctor: Doctor = defaultDoctor, renderer: Renderer = executeFrameRender, audioManager?: AudioManager, captionManager?: CaptionManager, videoRenderer?: VideoRenderer, framesRenderer?: FramesRenderer, shotRenderer?: ShotRenderer, checkRunner?: CheckRunner, skillsManager?: SkillsManager, inspectManager?: InspectManager, assetsManager?: AssetsManager): Promise<CliResult> {
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0]))
    return {code:0, stdout:(environment.terminal?.version ?? "development") + "\n", stderr:""};
  if (argv.length === 0 || (argv.length === 1 && ["--help", "-h", "help"].includes(argv[0])))
    return { code: 0, stdout: environment.terminal?.interactive ? terminalWelcome(environment.terminal) + usage.split("\n").slice(2).join("\n") : usage, stderr: "" };
  const [command, ...args] = argv;
  const wantsJson = args.includes("--json") || argv.includes("--json");
  const fail = (message: string, code = "ERR_UNKNOWN_COMMAND", name?: string): CliResult => {
    const hint = hintForCode(code);
    const next = nextForCode(code);
    return {
      code: 2,
      stdout: "",
      stderr: (wantsJson
        ? JSON.stringify({ success: false, ...(name ? { command: name } : {}), issues: [{ code, message, hint }], next })
        : message + "\n\n" + usage),
    };
  };
  if (command === "help") {
    if (args.length === 0) return { code: 0, stdout: usage, stderr: "" };
    if (args.length === 1 && Object.hasOwn(commandUsage, args[0])) return { code: 0, stdout: commandHelpText(args[0]), stderr: "" };
    return fail(`Unknown command: ${args[0] ?? ""}`, "ERR_UNKNOWN_COMMAND");
  }
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    if (Object.hasOwn(commandUsage, command)) return { code: 0, stdout: commandHelpText(command), stderr: "" };
    return fail(`Unknown command: ${command}`, "ERR_UNKNOWN_COMMAND");
  }
  if(command === "guide") {
    if (args.length === 1 && ["--help", "-h"].includes(args[0])) return { code: 0, stdout: commandHelpText("guide"), stderr: "" };
    if(args.length>1 || (args.length===1 && args[0]!=="--json"))return fail("Usage: flute guide [--json]", "ERR_UNKNOWN_OPTION", "guide");
    const guide=RESOURCES["authoring-guide"]({cliVersion: environment.terminal?.version ?? "development"});
    const text=[guide.purpose,guide.creativeFreedom,...guide.concepts.map(c=>`## ${c.title}\n${c.meaning}\nHow it works: ${c.mechanism}\nCreative choices: ${c.choices}\nWatch for: ${c.pitfalls}\nVerify: ${c.verify}`),"## Workflow\n"+guide.workflow.map((s,i)=>`${i+1}. ${s}`).join("\n"),"## Installed API and defaults\n"+JSON.stringify(guide.capabilities,null,2)].join("\n\n");
    return {code:0,stdout:(args[0]==="--json"?JSON.stringify({...guide,command:"guide"}):`${FLUTE_BRAND.title}\n${FLUTE_BRAND.url}\n\n${text}`)+"\n",stderr:""};
  }
  const aliases = { init: "init-project", sync: "sync-project", open: "open-preview", load: "load-project", validate: "validate-project" } as const;
  if (command !== "snapshot" && command !== "export" && command !== "scenes" && command !== "doctor" && command !== "render" && command !== "audio" && command !== "captions" && command !== "transitions" && command !== "frames" && command !== "shot" && command !== "check" && command !== "skills" && command !== "inspect" && command !== "assets" && !Object.hasOwn(aliases, command)) return fail(`Unknown command: ${command}`, "ERR_UNKNOWN_COMMAND");
  if (command === "transitions") return runTransitionsCommand(args, fail);
  // Subcommand-style media commands parse positionally before the flag loop.
  // Manager defaults resolve inside each branch (not in the signature) so unit
  // suites that mock project/commands keep working for unrelated commands.
  if (command === "audio") return runAudioCommand(args, environment, audioManager ?? executeAudioCommand, fail);
  if (command === "captions") return runCaptionsCommand(args, environment, captionManager ?? executeCaptionsCommand, fail);
  if (command === "skills") return runSkillsCommand(args, environment, skillsManager ?? executeSkillsCommand, fail);
  if (command === "inspect") return runInspectCommand(args, environment, inspectManager ?? executeInspectCommand, fail);
  if (command === "assets") return runAssetsCommand(args, environment, assetsManager ?? executeAssetsCommand, fail);
  const flagSets: Record<string, string[]> = {
    snapshot: ["--project","--url","--scene","--time","--json"],
    export: ["--project", "--url", "--output", "--fps", "--width", "--height", "--audio", "--captions", "--json"],
    doctor: ["--project", "--url", "--json"],
    render: ["--composition", "--frame", "--time", "--out", "--url", "--no-cache", "--cache-dir", "--parallel", "--fps", "--width", "--height", "--no-stream", "--project", "--json"],
    frames: ["--composition", "--out", "--every", "--at", "--url", "--no-cache", "--cache-dir", "--project", "--json"],
    shot: ["--scene", "--time", "--out", "--url", "--project", "--json"],
    check: ["--frames", "--video", "--manifest", "--budget-ms", "--project", "--json"],
  };
  const allowed: string[] = flagSets[command] ?? ["--project", "--package", "--url", "--no-open", "--json", "--scene", "--adapter", "--composition"];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!allowed.includes(flag)) return fail(`Unknown option: ${flag}`, "ERR_UNKNOWN_OPTION", command);
    if (flags.has(flag)) return fail(`Duplicate option: ${flag}`, "ERR_DUPLICATE_OPTION", command);
    if (["--no-open", "--json", "--no-cache", "--no-stream"].includes(flag)) flags.set(flag, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) return fail(`Missing value for ${flag}`, "ERR_MISSING_VALUE", command);
      flags.set(flag, value);
    }
  }
  if (flags.has("--adapter") && command !== "init") return fail("--adapter is only valid for init.", "ERR_INVALID_FLAG_COMBINATION", command);
  if (flags.has("--package") && command !== "init") return fail("--package is only valid for init.", "ERR_INVALID_FLAG_COMBINATION", command);
  if (flags.has("--composition") && !["validate", "render", "frames"].includes(command)) return fail("--composition is only valid for validate, render or frames.", "ERR_INVALID_FLAG_COMBINATION", command);
  if (flags.has("--scene") && !["load", "open", "snapshot", "shot"].includes(command)) return fail("--scene is only valid for load, open, shot or snapshot.", "ERR_INVALID_FLAG_COMBINATION", command);
  if (["load", "validate", "scenes", "sync", "doctor"].includes(command) && flags.has("--no-open")) return fail("Preview options require init or open.", "ERR_INVALID_FLAG_COMBINATION", command);
  if (["load", "validate", "scenes", "sync"].includes(command) && flags.has("--url")) return fail("Preview options require init or open.", "ERR_INVALID_FLAG_COMBINATION", command);
  if (command === "init" && flags.has("--no-open") && !flags.has("--url")) return fail("init --no-open requires --url. To initialize without opening a browser, run npx flute init.", "ERR_INVALID_FLAG_COMBINATION", command);
  const context = { root: flags.get("--project") as string ?? environment.root };
  const json = flags.has("--json");
  if (command === "doctor") {
    try {
      const result = await doctor({ ...(flags.has("--url") ? { url: flags.get("--url") as string } : {}) }, context);
      if (!result.success) return { code: 1, stdout: "", stderr: (json ? JSON.stringify(result) : result.issues.map(humanIssue).join("\n")) + "\n" };
      return { code: 0, stdout: (json ? JSON.stringify(result) : humanDoctor(result, environment.terminal?.unicode !== false)) + "\n", stderr: "" };
    } catch {
      return operationalFailure(command, [{ code: "ERR_INTERNAL", message: "Doctor failed unexpectedly. Check local files and permissions, then retry." }], json);
    }
  }
  if (command === "render") {
    const renderVideo = videoRenderer ?? executeVideoRender;
    if (!flags.has("--composition")) return fail("render requires --composition.", "ERR_MISSING_VALUE", command);
    if (!flags.has("--out")) return fail("render requires --out.", "ERR_MISSING_VALUE", command);
    const out = flags.get("--out") as string;
    const wantsFrame = flags.has("--frame") || flags.has("--time");
    if (wantsFrame) {
      if (flags.has("--frame") && flags.has("--time")) return fail("render needs exactly one of --frame or --time for stills.", "ERR_MISSING_VALUE", command);
      if (!out.toLowerCase().endsWith(".png")) return fail("Frame mode needs a .png --out; drop --frame/--time for video mode.", "invalid-input", command);
      for (const extra of ["--parallel", "--fps", "--width", "--height", "--no-stream"]) {
        if (flags.has(extra)) return fail(`${extra} is only valid for video mode (an .mp4 --out without --frame/--time).`, "ERR_INVALID_FLAG_COMBINATION", command);
      }
      try {
        const result = await renderer({
          composition: flags.get("--composition") as string,
          ...(flags.has("--frame") ? { frame: Number(flags.get("--frame")) } : { timeMs: Number(flags.get("--time")) }),
          out,
          ...(flags.has("--cache-dir") ? { cacheDir: flags.get("--cache-dir") as string } : {}),
          ...(flags.has("--no-cache") ? { noCache: true as const } : {}),
        }, {
          root: context.root,
          url: serverUrl(flags, environment),
          ...cliVersion(environment),
        });
        if (!result.success) return operationalFailure(command, result.issues, json);
        return { code: 0, stdout: (json ? JSON.stringify(withCommand(result, command))
          : `Rendered frame ${result.data.frame} (${result.data.timeMs}ms, scene ${result.data.sceneId}) to ${result.data.out}.${result.data.cached ? " (cached)" : ""}`) + "\n", stderr: "" };
      } catch {
        return operationalFailure(command, [{ code: "ERR_INTERNAL", message: "Frame render failed unexpectedly. Check the composition, scene server and retry." }], json);
      }
    }
    if (!out.toLowerCase().endsWith(".mp4")) return fail("Video mode needs an .mp4 --out; add --frame/--time for stills.", "invalid-input", command);
    const progress = progressCollector(json, flags.has("--no-stream"));
    try {
      const result = await renderVideo({
        composition: flags.get("--composition") as string,
        out,
        ...(flags.has("--parallel") ? { parallel: Number(flags.get("--parallel")) } : {}),
        ...(flags.has("--cache-dir") ? { cacheDir: flags.get("--cache-dir") as string } : {}),
        ...(flags.has("--no-cache") ? { noCache: true as const } : {}),
        ...(flags.has("--fps") ? { fps: Number(flags.get("--fps")) } : {}),
        ...(flags.has("--width") ? { width: Number(flags.get("--width")) } : {}),
        ...(flags.has("--height") ? { height: Number(flags.get("--height")) } : {}),
      }, {
        root: context.root,
        url: serverUrl(flags, environment),
        ...cliVersion(environment),
        ...(progress.onProgress ? { onProgress: progress.onProgress } : {}),
      });
      if (!result.success) return operationalFailure(command, result.issues, json);
      const human = `Rendered ${result.data.out} (${result.data.frames} frames at ${result.data.fps} FPS, ${result.data.width}x${result.data.height}, seed ${result.data.seed}, ${result.data.cachedFrames} cached).`;
      return { code: 0, stdout: progress.flush(json ? JSON.stringify(withCommand(result, command)) : human), stderr: "" };
    } catch {
      return operationalFailure(command, [{ code: "ERR_INTERNAL", message: "Video render failed unexpectedly. Check the composition, scene server and retry." }], json);
    }
  }
  if (command === "frames") {
    const framesOp = framesRenderer ?? executeFramesRender;
    if (!flags.has("--composition")) return fail("frames requires --composition.", "ERR_MISSING_VALUE", command);
    if (!flags.has("--out")) return fail("frames requires --out.", "ERR_MISSING_VALUE", command);
    if (flags.has("--every") && flags.has("--at")) return fail("Pass only one of --every or --at.", "ERR_INVALID_FLAG_COMBINATION", command);
    const progress = progressCollector(json, false);
    try {
      const result = await framesOp({
        composition: flags.get("--composition") as string,
        out: flags.get("--out") as string,
        ...(flags.has("--every") ? { every: Number(flags.get("--every")) } : {}),
        ...(flags.has("--at") ? { at: String(flags.get("--at")).split(",").map((v) => Number(v.trim())) } : {}),
        ...(flags.has("--cache-dir") ? { cacheDir: flags.get("--cache-dir") as string } : {}),
        ...(flags.has("--no-cache") ? { noCache: true as const } : {}),
      }, {
        root: context.root,
        url: serverUrl(flags, environment),
        ...cliVersion(environment),
        ...(progress.onProgress ? { onProgress: progress.onProgress } : {}),
      });
      if (!result.success) return operationalFailure(command, result.issues, json);
      const human = `Extracted ${result.data.total} frames to ${result.data.out}/ (manifest ${result.data.manifest}).`;
      return { code: 0, stdout: progress.flush(json ? JSON.stringify(withCommand(result, command)) : human), stderr: "" };
    } catch {
      return operationalFailure(command, [{ code: "ERR_INTERNAL", message: "Frame extraction failed unexpectedly. Check the composition, scene server and retry." }], json);
    }
  }
  if (command === "shot") {
    const shotOp = shotRenderer ?? executeShotRender;
    if (!flags.has("--scene")) return fail("shot requires --scene.", "ERR_MISSING_VALUE", command);
    if (!flags.has("--time")) return fail("shot requires --time.", "ERR_MISSING_VALUE", command);
    if (!flags.has("--out")) return fail("shot requires --out.", "ERR_MISSING_VALUE", command);
    try {
      const result = await shotOp({
        scene: flags.get("--scene") as string,
        timeMs: Number(flags.get("--time")),
        out: flags.get("--out") as string,
      }, {
        root: context.root,
        url: serverUrl(flags, environment),
        ...cliVersion(environment),
      });
      if (!result.success) return operationalFailure(command, result.issues, json);
      return { code: 0, stdout: (json ? JSON.stringify(withCommand(result, command))
        : `Captured ${result.data.sceneId} at ${result.data.timeMs}ms to ${result.data.out}.`) + "\n", stderr: "" };
    } catch {
      return operationalFailure(command, [{ code: "ERR_INTERNAL", message: "Shot capture failed unexpectedly. Check the scene, server and retry." }], json);
    }
  }
  if (command === "check") {
    const checkOp = checkRunner ?? executeCheck;
    if (flags.has("--frames") === flags.has("--video")) return fail("check needs exactly one of --frames or --video.", "ERR_MISSING_VALUE", command);
    try {
      const result = await checkOp({
        ...(flags.has("--frames") ? { frames: flags.get("--frames") as string } : { video: flags.get("--video") as string }),
        ...(flags.has("--manifest") ? { manifest: flags.get("--manifest") as string } : {}),
        ...(flags.has("--budget-ms") ? { budgetMs: Number(flags.get("--budget-ms")) } : {}),
      }, { root: context.root });
      if (!result.success) {
        const body = json ? JSON.stringify(result) : `${"data" in result && result.data ? `${humanCheck(result.data.checks, environment.terminal?.unicode !== false)}\n` : ""}${result.issues.map(humanIssue).join("\n")}`;
        return { code: 1, stdout: "", stderr: `${body}\n` };
      }
      return { code: 0, stdout: (json ? JSON.stringify(result) : humanCheck(result.data.checks, environment.terminal?.unicode !== false)) + "\n", stderr: "" };
    } catch {
      return operationalFailure(command, [{ code: "ERR_INTERNAL", message: "Visual check failed unexpectedly. Check the rendered evidence and retry." }], json);
    }
  }
  if (command === "frames") {
    const framesOp = framesRenderer ?? executeFramesRender;
    if (!flags.has("--composition")) return fail("frames requires --composition.", "ERR_MISSING_VALUE", command);
    if (!flags.has("--out")) return fail("frames requires --out.", "ERR_MISSING_VALUE", command);
    if (flags.has("--every") && flags.has("--at")) return fail("Pass only one of --every or --at.", "ERR_INVALID_FLAG_COMBINATION", command);
    const progress = progressCollector(json, false);
    try {
      const result = await framesOp({
        composition: flags.get("--composition") as string,
        out: flags.get("--out") as string,
        ...(flags.has("--every") ? { every: Number(flags.get("--every")) } : {}),
        ...(flags.has("--at") ? { at: String(flags.get("--at")).split(",").map((v) => Number(v.trim())) } : {}),
        ...(flags.has("--cache-dir") ? { cacheDir: flags.get("--cache-dir") as string } : {}),
        ...(flags.has("--no-cache") ? { noCache: true as const } : {}),
      }, {
        root: context.root,
        url: serverUrl(flags, environment),
        ...cliVersion(environment),
        ...(progress.onProgress ? { onProgress: progress.onProgress } : {}),
      });
      if (!result.success) return operationalFailure(command, result.issues, json);
      const human = `Extracted ${result.data.total} frames to ${result.data.out}/ (manifest ${result.data.manifest}).`;
      return { code: 0, stdout: progress.flush(json ? JSON.stringify(withCommand(result, command)) : human), stderr: "" };
    } catch {
      return operationalFailure(command, [{ code: "ERR_INTERNAL", message: "Frame extraction failed unexpectedly. Check the composition, scene server and retry." }], json);
    }
  }
  if (command === "shot") {
    const shotOp = shotRenderer ?? executeShotRender;
    if (!flags.has("--scene")) return fail("shot requires --scene.", "ERR_MISSING_VALUE", command);
    if (!flags.has("--time")) return fail("shot requires --time.", "ERR_MISSING_VALUE", command);
    if (!flags.has("--out")) return fail("shot requires --out.", "ERR_MISSING_VALUE", command);
    try {
      const result = await shotOp({
        scene: flags.get("--scene") as string,
        timeMs: Number(flags.get("--time")),
        out: flags.get("--out") as string,
      }, {
        root: context.root,
        url: serverUrl(flags, environment),
        ...cliVersion(environment),
      });
      if (!result.success) return operationalFailure(command, result.issues, json);
      return { code: 0, stdout: (json ? JSON.stringify(withCommand(result, command))
        : `Captured ${result.data.sceneId} at ${result.data.timeMs}ms to ${result.data.out}.`) + "\n", stderr: "" };
    } catch {
      return operationalFailure(command, [{ code: "ERR_INTERNAL", message: "Shot capture failed unexpectedly. Check the scene, server and retry." }], json);
    }
  }
  if (command === "check") {
    const checkOp = checkRunner ?? executeCheck;
    if (flags.has("--frames") === flags.has("--video")) return fail("check needs exactly one of --frames or --video.", "ERR_MISSING_VALUE", command);
    try {
      const result = await checkOp({
        ...(flags.has("--frames") ? { frames: flags.get("--frames") as string } : { video: flags.get("--video") as string }),
        ...(flags.has("--manifest") ? { manifest: flags.get("--manifest") as string } : {}),
        ...(flags.has("--budget-ms") ? { budgetMs: Number(flags.get("--budget-ms")) } : {}),
      }, { root: context.root });
      if (!result.success) {
        const body = json ? JSON.stringify(result) : `${"data" in result && result.data ? `${humanCheck(result.data.checks, environment.terminal?.unicode !== false)}\n` : ""}${result.issues.map(humanIssue).join("\n")}`;
        return { code: 1, stdout: "", stderr: `${body}\n` };
      }
      return { code: 0, stdout: (json ? JSON.stringify(result) : humanCheck(result.data.checks, environment.terminal?.unicode !== false)) + "\n", stderr: "" };
    } catch {
      return operationalFailure(command, [{ code: "ERR_INTERNAL", message: "Visual check failed unexpectedly. Check the rendered evidence and retry." }], json);
    }
  }
  if(command==="snapshot"){
    if(!flags.has("--scene")||!flags.has("--url"))return fail("snapshot requires --scene and --url.", "ERR_MISSING_VALUE", command);
    try{
      const result=await snapshotter({sceneId:flags.get("--scene"),url:flags.get("--url"),...(flags.has("--time")?{timeMs:Number(flags.get("--time"))}:{})},context);
      if (!result.success) return operationalFailure(command, result.issues, json);
      return {code:0,stdout:(json?JSON.stringify(withCommand(result, command)):`Snapshot saved for ${result.data.sceneId}.`)+"\n",stderr:""};
    }catch{return operationalFailure(command, [{code:"ERR_INTERNAL", message:"Snapshot failed. Check the scene and retry."}], json)}
  }
  if (command === "scenes" || flags.has("--scene")) {
    const operation = command === "scenes" ? "list-scenes" : command === "open" ? "open-scene" : "load-scene";
    const input = command === "scenes" ? {} : { sceneId: flags.get("--scene"), ...(command === "open" ? {
      url: flags.get("--url") ?? `http://127.0.0.1:${environment.port ?? "5173"}`, launch: !flags.has("--no-open"),
    } : {}) };
    try { return recipeOutput(await recipes(operation, input, context), json, command === "scenes" ? "scenes" : command); }
    catch { return operationalFailure(command, [{code:"ERR_INTERNAL", message:"Scene command failed unexpectedly. Check the local recipes and retry."}], json); }
  }
  if (command === "export") {
    if (!flags.has("--url") || !flags.has("--output")) return fail("export requires --url and --output.", "ERR_MISSING_VALUE", command);
    const input = { url: flags.get("--url"), output: flags.get("--output"),
      ...Object.fromEntries(["fps", "width", "height"].filter(key => flags.has(`--${key}`)).map(key => [key, Number(flags.get(`--${key}`))])),
      ...(flags.has("--audio") ? { audio: flags.get("--audio") } : {}),
      ...(flags.has("--captions") ? { captions: flags.get("--captions") } : {}) };
    try {
      const result = await exporter(input, context);
      if (!result.success) return operationalFailure(command, result.issues, json);
      const extras = result.data.audio || result.data.captions
        ? ` (${[result.data.audio ? `audio drift ${result.data.audio.driftMs}ms` : "", result.data.captions ? `${result.data.captions.cues} cues burned` : ""].filter(Boolean).join(", ")})`
        : "";
      return { code: 0, stdout: (json ? JSON.stringify(withCommand(result, command)) : `Exported ${result.data.output} (${result.data.frames} frames at ${result.data.fps} FPS)${extras}.`) + "\n", stderr: "" };
    } catch { return operationalFailure(command, [{code:"ERR_INTERNAL", message:"Video export failed unexpectedly. Check the local scene server and retry."}], json); }
  }
  const input = command === "init" ? { ...(flags.has("--adapter") ? {adapter:flags.get("--adapter")} : {}), ...(flags.has("--package") ? { packageSource: flags.get("--package") } : {}) }
    : command === "open" ? { url: flags.get("--url") ?? `http://127.0.0.1:${environment.port ?? "5173"}`, launch: !flags.has("--no-open") }
    : command === "validate" ? { ...(flags.has("--composition") ? { composition: flags.get("--composition") } : {}) } : {};
  const onboarding = command === "init" ? {terminal:environment.terminal, streamed:!json && !!environment.progress} : undefined;
  if (onboarding?.streamed) environment.progress!(terminalWelcome(environment.terminal) + "Preparing your project…\n");
  try {
    const result = await execute(aliases[command as keyof typeof aliases], input, context);
    if (!result.success || command !== "init" || !flags.has("--url")) return output(result, json, command, onboarding);
    const opened = await execute("open-preview", { url: flags.get("--url"), launch: !flags.has("--no-open") }, context);
    if (opened.success) return output({ success: true, data: { ...result.data, ...opened.data } }, json, command, onboarding);
    const failure = output(opened, json, command);
    return json ? failure : { ...failure, stdout: output(result, false, command, onboarding).stdout };
  } catch {
    return operationalFailure(command, [{code:"ERR_INTERNAL", message:"Project command failed unexpectedly. Your setup may be incomplete; run flute validate, correct the reported issue and retry."}], json);
  }
}
