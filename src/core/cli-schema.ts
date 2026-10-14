import { z } from "zod";

/** SOURCE OF TRUTH: agent-first CLI contracts.
 * WHAT: machine-readable issue envelope, stable error catalog with hints, command index and doctor checks.
 * WHY: coding agents parse --json output without regex and route to the next command deterministically.
 * WHERE: cli/index normalizes every result through these schemas; authoring embeds the command index in the guide.
 * Core stays pure: no filesystem, process or browser access here; services own all effects.
 */

// Every machine-readable issue carries a stable code, a human message, an
// optional dotted path and exactly one hint describing the next fix action.
export const CliIssueSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  path: z.string().optional(),
  hint: z.string().optional(),
});
export type CliIssue = z.output<typeof CliIssueSchema>;

// Operation envelope: success carries data, failure carries at least one
// issue. `command` names the CLI command that produced the result so agents
// can correlate transcripts; `next` lists 0-2 follow-up commands.
export const CliSuccessSchema = z.strictObject({
  success: z.literal(true),
  command: z.string().min(1).optional(),
  data: z.unknown(),
  warnings: z.array(CliIssueSchema).optional(),
  next: z.array(z.string()).optional(),
});
export const CliFailureSchema = z.strictObject({
  success: z.literal(false),
  command: z.string().min(1).optional(),
  issues: z.array(CliIssueSchema).min(1),
  next: z.array(z.string()).optional(),
});
export const CliEnvelopeSchema = z.discriminatedUnion("success", [CliSuccessSchema, CliFailureSchema]);
export type CliEnvelope = z.output<typeof CliEnvelopeSchema>;

/** SOURCE OF TRUTH: CLI error catalog.
 * WHAT: stable codes with one hint and 0-2 follow-up commands each.
 * WHY: skills pin these codes; agents map failures to fixes without guessing.
 * WHERE: cli/index emits them for usage errors; normalizeIssue backfills hints for operation errors.
 * Legacy kebab-case operation codes (conflict, missing-dev-server, ...) are
 * preserved for backward compatibility and gain hints through this same table.
 */
export const CLI_ERROR_CATALOG: Record<string, { hint: string; next: string[] }> = {
  // Usage errors (exit 2).
  ERR_UNKNOWN_COMMAND: { hint: "Run velora --help to list available commands.", next: ["velora --help"] },
  ERR_UNKNOWN_OPTION: { hint: "Run velora <command> --help to list supported flags.", next: ["velora <command> --help"] },
  ERR_MISSING_VALUE: { hint: "Supply a value for the flag; run velora <command> --help for usage.", next: ["velora <command> --help"] },
  ERR_DUPLICATE_OPTION: { hint: "Pass each flag once; run velora <command> --help for usage.", next: ["velora <command> --help"] },
  ERR_INVALID_FLAG_COMBINATION: { hint: "Run velora <command> --help to see which flags combine.", next: ["velora <command> --help"] },
  // Agent-first operation errors (exit 1).
  ERR_INVALID_PROJECT: { hint: "Run velora doctor --json to diagnose the project, then velora init to repair setup.", next: ["velora doctor --json"] },
  ERR_SCENE_NOT_FOUND: { hint: "Run velora scenes --json to list available scene IDs.", next: ["velora scenes --json"] },
  ERR_SCENE_INVALID: { hint: "Run velora validate --json for field-accurate diagnostics, then fix the recipe.", next: ["velora validate --json"] },
  ERR_BINDING_MISSING: { hint: "Add the sibling <id>.tsx component matching the recipe, then run velora sync.", next: ["velora sync"] },
  ERR_FOCUS_INVALID: { hint: "Read npx velora guide --json (focus concept): distance must exceed focalLength; version 2 radial fields are rejected.", next: ["velora guide --json"] },
  ERR_DURATION_INVALID: { hint: "Use a duration between 1ms and 120000ms and re-validate.", next: ["velora validate --json"] },
  ERR_FPS_UNSUPPORTED: { hint: "Use --fps 30, 60 or 120.", next: ["velora <command> --help"] },
  ERR_SERVER_UNREACHABLE: { hint: "Start the app with npm run dev, then retry with its loopback origin.", next: ["velora doctor --json"] },
  ERR_CAPTURE_NO_BRIDGE: { hint: "Open a scene with capture enabled (ScenePreview registers the bridge) and retry.", next: ["velora doctor --json"] },
  ERR_FFMPEG_MISSING: { hint: "Install FFmpeg and ensure ffmpeg is available on PATH.", next: ["velora doctor --json"] },
  ERR_CHROMIUM_MISSING: { hint: "Install the browser: npm install playwright && npx playwright install chromium.", next: ["velora doctor --json"] },
  ERR_OUTPUT_UNWRITABLE: { hint: "Choose another project-relative .mp4 path without traversal.", next: ["velora <command> --help"] },
  ERR_SNAPSHOT_STALE: { hint: "Scene source changed; retry the snapshot to capture the current source.", next: ["velora snapshot --help"] },
  ERR_NODE_UNSUPPORTED: { hint: "Use Node >=22.12.0, then retry.", next: ["velora doctor --json"] },
  ERR_COMPOSITION_INVALID: { hint: "Use a *.composition.json file matching the schema; run velora inspect --composition <file> --json for field diagnostics.", next: ["velora inspect --composition <file> --json"] },
  ERR_ASSET_NOT_FOUND: { hint: "Run velora assets ls --json to list available asset IDs.", next: ["velora assets ls --json"] },
  ERR_ASSET_UNSUPPORTED: { hint: "Use PNG/JPEG/WebP/GIF/SVG images, MP4/WebM video, MP3/WAV/OGG audio or TTF/OTF/WOFF fonts with lowercase slug filenames.", next: ["velora assets check --json"] },
  ERR_ASSET_TOO_LARGE: { hint: "Compress the asset below 50MB, then retry.", next: ["velora assets check --json"] },
  ERR_TIMELINE_INVALID: { hint: "Fix the timeline structure; run velora inspect --composition <file> --json for field diagnostics.", next: ["velora inspect --composition <file> --json"] },
  ERR_TIMELINE_OVERLAP: { hint: "Butt-join segments or trim them so no segment starts before the previous one ends.", next: ["velora inspect --composition <file> --json"] },
  ERR_FRAME_OUT_OF_RANGE: { hint: "Pick a frame within the timeline span; run velora inspect --composition <file> --json for totals.", next: ["velora inspect --composition <file> --json"] },
  ERR_AUDIO_INVALID: { hint: "Fix the audio track parameters; run velora audio check --composition <file> --json for field diagnostics.", next: ["velora audio check --composition <file> --json"] },
  ERR_AUDIO_CODEC: { hint: "Use AAC, MP3, Opus, Vorbis, FLAC or WAV audio.", next: ["velora audio check --composition <file> --json"] },
  ERR_AUDIO_DRIFT: { hint: "Trim audio to the video span so A/V drift stays within 40ms.", next: ["velora audio check --composition <file> --json"] },
  ERR_CAPTION_INVALID: { hint: "Fix the caption file syntax; run velora captions validate --file <file> --json for block diagnostics.", next: ["velora captions validate --file <file> --json"] },
  ERR_CAPTION_OVERLAP: { hint: "Shift the cue so it starts after the previous cue ends.", next: ["velora captions validate --file <file> --json"] },
  ERR_CAPTION_TIMING: { hint: "Keep cues inside the timeline span at 20 chars/sec or less; split long cues.", next: ["velora captions validate --file <file> --json"] },
  ERR_TRANSITION_INVALID: { hint: "Use a catalogued transition within the segment span; run velora transitions ls --json for the catalog.", next: ["velora transitions ls --json"] },
  ERR_PROCEDURAL_BUDGET: { hint: "Reduce counts below the 200-node budget or bake layers to an asset.", next: ["velora validate --json"] },
  ERR_ANIMATION_CLOCK: { hint: "Remove ScrollTrigger, ticker and rAF clocks from scene sources; drive motion from video time.", next: ["velora validate --json"] },
  ERR_WEBGL_CONTEXT: { hint: "Supply fallback content; this device cannot create a WebGL context.", next: ["velora doctor --json"] },
  ERR_WEBGL_TIMELOOP: { hint: "Drive the WebGL scene from the timeMs prop instead of rAF or tickers.", next: ["velora validate --json"] },
  ERR_VISUAL_MANIFEST: { hint: "Re-render to regenerate the manifest; run velora check --help for targets.", next: ["velora check --help"] },
  ERR_VISUAL_BLANK: { hint: "Inspect the reported frames; blank renders mean an empty scene or a lost capture viewport.", next: ["velora frames --help"] },
  ERR_VISUAL_DIMENSIONS: { hint: "Re-render: frame dimensions must match the composition canvas.", next: ["velora render --help"] },
  ERR_VISUAL_COVERAGE: { hint: "Add frames covering every cue window or trim the captions.", next: ["velora frames --help"] },
  ERR_VISUAL_DRIFT: { hint: "Trim audio to the video span so drift stays within 40ms.", next: ["velora audio check --composition <file> --json"] },
  ERR_VISUAL_BUDGET: { hint: "Reduce scene cost or raise --budget-ms; budgets are device evidence, not promises.", next: ["velora check --help"] },
  ERR_SKILL_MISSING: { hint: "Run velora skills ls to list available skills, then install with velora skills install --dir <path>.", next: ["velora skills ls"] },
  ERR_SKILL_VERSION: { hint: "Re-run velora skills install --dir <path> to refresh skills to the installed CLI version.", next: ["velora skills install --help"] },
  ERR_SKILL_INVALID: { hint: "Fix the skill front-matter and required sections; run velora skills check for details.", next: ["velora skills check"] },
  ERR_SKILL_CONFLICT: { hint: "Preserve or move the differing file, then retry the install.", next: ["velora skills check --dir <path>"] },
  ERR_REACT_UNSUPPORTED: { hint: "Run npm install in the project root to install declared React 18.2+ or 19.x dependencies.", next: ["velora doctor --json"] },
  ERR_TOOLKIT_MISSING: { hint: "Install the local Velora .tgz with npm install /path/to/velora.tgz, then run velora init.", next: ["velora doctor --json"] },
  ERR_INTERNAL: { hint: "Run velora doctor --json to diagnose; if the failure persists, report the command and its --json output.", next: ["velora doctor --json"] },
  // Legacy operation codes (kept stable; every one gains a hint here).
  "invalid-operation": { hint: "Run velora --help to list available operations.", next: ["velora --help"] },
  "invalid-input": { hint: "Run velora <command> --help for the expected input shape.", next: ["velora <command> --help"] },
  "invalid-scope": { hint: "Provide an absolute local project directory with --project.", next: ["velora doctor --json"] },
  "invalid-file": { hint: "Restore the reported project file, then run velora validate --json.", next: ["velora validate --json"] },
  "invalid-scenes": { hint: "Run velora scenes --json to inspect the catalog, then fix the reported recipe.", next: ["velora scenes --json"] },
  "invalid-scene": { hint: "Run velora scenes --json to list available scenes, then retry with a valid ID.", next: ["velora scenes --json"] },
  "invalid-export": { hint: "Run velora export --help for the expected arguments.", next: ["velora export --help"] },
  "invalid-snapshot": { hint: "Run velora snapshot --help for the expected arguments.", next: ["velora snapshot --help"] },
  "invalid-capture": { hint: "Open a scene with capture enabled and retry; static scenes support snapshots, not video export.", next: ["velora doctor --json"] },
  "unsupported-project": { hint: "Run velora init inside an npm Vite React project, or velora init --adapter react for custom renderers.", next: ["velora doctor --json"] },
  "unsupported": { hint: "Run velora doctor --json to diagnose the project.", next: ["velora doctor --json"] },
  "not-initialized": { hint: "Run velora init in this project first.", next: ["velora init"] },
  "incomplete-setup": { hint: "Run velora init again to resume setup safely.", next: ["velora init"] },
  "missing-installation": { hint: "Run npm install in the project root, then retry velora init.", next: ["velora doctor --json"] },
  "missing-dev-server": { hint: "Run npm run dev in the project, then retry with its loopback URL.", next: ["velora doctor --json"] },
  "wrong-dev-server": { hint: "Point --url at this project's running dev server origin.", next: ["velora doctor --json"] },
  "manual-preview": { hint: "Mount src/velora/ProjectPreview.jsx, then open the renderer route with ?velora-preview=1.", next: ["velora guide --json"] },
  "missing-ffmpeg": { hint: "Install FFmpeg and ensure ffmpeg is available on PATH.", next: ["velora doctor --json"] },
  "missing-chromium": { hint: "Install the browser: npm install playwright && npx playwright install chromium.", next: ["velora doctor --json"] },
  "missing-capture": { hint: "Open a scene with capture enabled and retry.", next: ["velora doctor --json"] },
  "encoding-failed": { hint: "Retry the export; check that FFmpeg supports libx264 on this machine.", next: ["velora doctor --json"] },
  "export-failed": { hint: "Check the local scene server and retry; run velora doctor --json to diagnose.", next: ["velora doctor --json"] },
  "export-cancelled": { hint: "Retry the export without cancelling.", next: ["velora export --help"] },
  "snapshot-failed": { hint: "Check the scene, browser installation and source, then retry.", next: ["velora doctor --json"] },
  "snapshot-too-large": { hint: "Simplify the scene source before retrying.", next: ["velora validate --json"] },
  "source-changed": { hint: "Retry the snapshot to capture the current source.", next: ["velora snapshot --help"] },
  "output-exists": { hint: "Choose another .mp4 filename.", next: ["velora export --help"] },
  "denied-path": { hint: "Use a project-relative path outside protected files.", next: ["velora <command> --help"] },
  "package-unavailable": { hint: "Correct --package to an existing local .tgz file, or install velora locally first.", next: ["velora init --help"] },
  "process-failed": { hint: "Check npm installation and retry.", next: ["velora doctor --json"] },
  conflict: { hint: "Preserve or move the reported file, then retry; run velora validate --json for details.", next: ["velora validate --json"] },
  "project-error": { hint: "Check local files and permissions, then run velora doctor --json.", next: ["velora doctor --json"] },
};
export const CLI_ERROR_CODES = Object.freeze(Object.keys(CLI_ERROR_CATALOG));

export function hintForCode(code: string): string {
  return CLI_ERROR_CATALOG[code]?.hint ?? CLI_ERROR_CATALOG.ERR_INTERNAL.hint;
}
export function nextForCode(code: string): string[] {
  return CLI_ERROR_CATALOG[code]?.next ?? CLI_ERROR_CATALOG.ERR_INTERNAL.next;
}

// Attach the catalog hint (and keep any caller-supplied hint). Never throws;
// unknown shapes become ERR_INTERNAL so machine consumers always get a code.
export function normalizeIssue(issue: unknown): CliIssue {
  const parsed = CliIssueSchema.safeParse(issue);
  const base = parsed.success
    ? parsed.data
    : {
        code: "ERR_INTERNAL",
        message:
          typeof issue === "object" && issue !== null && "message" in issue && typeof (issue as { message: unknown }).message === "string"
            ? (issue as { message: string }).message
            : "An unexpected error occurred.",
      };
  return { ...base, hint: base.hint ?? hintForCode(base.code) };
}
export function nextForIssues(issues: readonly CliIssue[]): string[] {
  const first = issues[0];
  return first ? nextForCode(first.code) : nextForCode("ERR_INTERNAL");
}

/** SOURCE OF TRUTH: CLI command index for agents.
 * WHAT: every command with its flags, an example and the skill that teaches it.
 * WHY: `guide --json` carries this index so agents route without loading every skill.
 * WHERE: cli/index renders matching --help text; skills quote these entries verbatim.
 * Every entry names a real command with real flags; skill pointers name real skills.
 */
export const CLI_COMMANDS = Object.freeze([
  { name: "guide", description: "Print the versioned authoring guide (concepts, workflow, API).", flags: ["--json"], example: "velora guide --json", skill: "velora-scenes" },
  { name: "init", description: "Initialize the project connection and agent handoff.", flags: ["--adapter", "--project", "--package", "--url", "--no-open", "--json"], example: "velora init --json", skill: "velora-init" },
  { name: "open", description: "Verify the dev server and open the preview.", flags: ["--scene", "--project", "--url", "--no-open", "--json"], example: "velora open --no-open --json", skill: "velora-init" },
  { name: "sync", description: "Refresh the scene registry after adding or removing scene files.", flags: ["--project", "--json"], example: "velora sync --json", skill: "velora-init" },
  { name: "scenes", description: "List validated scene recipes in the project catalog.", flags: ["--project", "--json"], example: "velora scenes --json", skill: "velora-composition" },
  { name: "load", description: "Load one scene recipe source.", flags: ["--scene", "--project", "--json"], example: "velora load --scene <id> --json", skill: "velora-composition" },
  { name: "validate", description: "Validate the project, recipes, bindings, assets and optional composition.", flags: ["--project", "--composition", "--json"], example: "velora validate --composition teaser.composition.json --json", skill: "velora-debug" },
  { name: "inspect", description: "Inspect the project, one scene or one composition file without mutating anything.", flags: ["--project", "--scene", "--composition", "--json"], example: "velora inspect --scene <id> --json", skill: "velora-composition" },
  { name: "assets", description: "Manage project assets in assets/ (add, ls, rm, check).", flags: ["--as", "--id", "--yes", "--project", "--json"], example: "velora assets ls --json", skill: "velora-composition" },
  { name: "snapshot", description: "Capture one frame PNG into the scene recipe.", flags: ["--scene", "--url", "--time", "--project", "--json"], example: "velora snapshot --scene <id> --url <origin> --json", skill: "velora-render" },
  { name: "export", description: "Render the live scene to MP4 through the capture bridge.", flags: ["--url", "--output", "--fps", "--width", "--height", "--audio", "--captions", "--project", "--json"], example: "velora export --url <scene-url> --output clip.mp4 --json", skill: "velora-export" },
  { name: "doctor", description: "Check Node, React, toolkit, scenes and capture prerequisites.", flags: ["--project", "--url", "--json"], example: "velora doctor --json", skill: "velora-debug" },
  { name: "render", description: "Render one exact frame (PNG) or a full video (MP4) from a composition.", flags: ["--composition", "--frame", "--time", "--out", "--parallel", "--no-cache", "--cache-dir", "--fps", "--width", "--height", "--url", "--project", "--json", "--no-stream"], example: "velora render --composition teaser.composition.json --out teaser.mp4 --json", skill: "velora-export" },
  { name: "frames", description: "Extract a PNG sequence plus manifest.json from a composition.", flags: ["--composition", "--out", "--every", "--at", "--no-cache", "--cache-dir", "--url", "--project", "--json"], example: "velora frames --composition teaser.composition.json --out stills --every 30 --json", skill: "velora-render" },
  { name: "shot", description: "Capture one still from a single scene without a composition.", flags: ["--scene", "--time", "--out", "--url", "--project", "--json"], example: "velora shot --scene demo --time 500 --out shot.png --json", skill: "velora-render" },
  { name: "check", description: "Run automated visual checks over rendered frames or video.", flags: ["--frames", "--video", "--manifest", "--budget-ms", "--project", "--json"], example: "velora check --frames stills --json", skill: "velora-verify" },
  { name: "audio", description: "List and check composition audio tracks against discovered assets.", flags: ["--composition", "--project", "--json"], example: "velora audio check --composition teaser.composition.json --json", skill: "velora-audio" },
  { name: "captions", description: "Validate caption files and check them against a composition.", flags: ["--file", "--composition", "--project", "--json"], example: "velora captions validate --file subs.srt --json", skill: "velora-audio" },
  { name: "transitions", description: "List the transition catalog or describe one transition.", flags: ["--type", "--json"], example: "velora transitions ls --json", skill: "velora-transitions" },
  { name: "skills", description: "Install, list and check the Velora skills library.", flags: ["--dir", "--agent", "--source", "--json"], example: "velora skills install --dir <path> --json", skill: "velora" },
]);
export const CLI_COMMAND_NAMES = Object.freeze(CLI_COMMANDS.map((command) => command.name));
export type CliCommandName = (typeof CLI_COMMAND_NAMES)[number];

export const CommandIndexSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  flags: z.array(z.string()),
  example: z.string(),
  skill: z.string(),
});

// One doctor check: a stable id, a human label, pass/fail and evidence.
// Failed checks also surface as issues[] so exit codes stay predictable.
export const DoctorCheckSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  pass: z.boolean(),
  detail: z.string().optional(),
  hint: z.string().optional(),
  code: z.string().optional(),
});
export type DoctorCheck = z.output<typeof DoctorCheckSchema>;
export const DoctorResultSchema = z.discriminatedUnion("success", [
  z.strictObject({
    success: z.literal(true),
    command: z.literal("doctor"),
    data: z.strictObject({ checks: z.array(DoctorCheckSchema) }),
    warnings: z.array(CliIssueSchema).optional(),
    next: z.array(z.string()).optional(),
  }),
  z.strictObject({
    success: z.literal(false),
    command: z.literal("doctor"),
    data: z.strictObject({ checks: z.array(DoctorCheckSchema) }).optional(),
    issues: z.array(CliIssueSchema).min(1),
    next: z.array(z.string()).optional(),
  }),
]);
export type DoctorResult = z.output<typeof DoctorResultSchema>;
