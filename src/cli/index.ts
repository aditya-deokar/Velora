import { RESOURCES } from "../core/resources";
import { VELORA_BRAND } from "../core/branding";
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
import { PROMPT_LIBRARY, findPrompt, promptPlaceholders } from "../core/prompts";
import { ALL_DELIVER_TARGETS } from "../core/deliverables";
import { formatOnboarding, terminalWelcome, type TerminalOptions } from "./terminal";
import { executeDeliver, executeDepthResolve, executeFrameRender, executeVideoRender, executeFramesRender, executeShotRender, executeCheck, executeSceneSnapshot, executeVideoExport, probeCapturePrerequisites } from "../export/commands";
import { executeCreateCommand, executeStudioCommand, executeDoctorCommand, executeProjectCommand, executeAudioCommand, executeCaptionsCommand, executeSkillsCommand, executeInspectCommand, executeAssetsCommand, executeTemplateCommand, executeBrandCommand, executeEditorialCommand, type TemplateCommandResult, type BrandCommandResult, type EditorialCommandResult } from "../project/commands";
import { executeRecipeCommand, type RecipeCommandResult } from "../project/recipes";
import { executeEditCommand, type EditOperation } from "../project/edit";
import { executeCompositionEdit } from "../project/composition-edit";
import type { ProjectResult } from "../core/project";
import { StageDprSchema } from "../core/stage";
import type { DepthConfig } from "../core/depth";

/** SOURCE OF TRUTH: runCli adapter.
 * WHAT: translate terminal arguments into canonical project operations and format results.
 * WHY: installation policy and side effects remain behind the project command boundary.
 * WHERE: cli/main invokes this adapter; project/commands validates and executes requests.
 * Agent-first contract: every command supports --help and --json; exit 0 on
 * success, 1 on operational failure (issues[] with stable codes+hints), 2 on
 * usage errors. No command prompts for input; --json bypasses all presentation.
 */
type Environment = { root: string; port?: string; terminal?: TerminalOptions; progress?: (text: string) => void;
  // Long-running commands (studio) print their ready line through emit and register a stop for Ctrl-C.
  emit?: (text: string) => void; onShutdown?: (stop: () => Promise<void>) => void;
  // velora edit apply --ops - reads the batch from standard input.
  readStdin?: () => Promise<string> };
type Execute = typeof executeProjectCommand;
type Doctor = (input: { url?: string }, context: { root: string }) => Promise<DoctorResult>;
type Renderer = typeof executeFrameRender;
type AudioManager = typeof executeAudioCommand;
type CaptionManager = typeof executeCaptionsCommand;
type SkillsManager = typeof executeSkillsCommand;
type InspectManager = typeof executeInspectCommand;
type AssetsManager = typeof executeAssetsCommand;
type TemplateManager = typeof executeTemplateCommand;
type BrandManager = typeof executeBrandCommand;
type EditorialManager = typeof executeEditorialCommand;
type VideoRenderer = typeof executeVideoRender;
type FramesRenderer = typeof executeFramesRender;
type ShotRenderer = typeof executeShotRender;
type CheckRunner = typeof executeCheck;
export type CliResult = { code: number; stdout: string; stderr: string };
const usage = `${VELORA_BRAND.title} — cinematic 3D motion from your real application UI.
${VELORA_BRAND.url}
Start with npx velora guide to learn spatial composition, camera, focus and motion.

velora --version
velora help [command]
velora guide [--json]
velora init [--adapter auto|react] [--project DIR] [--package TARBALL] [--url ORIGIN] [--no-open]
velora open [--scene ID] [--project DIR] [--url ORIGIN] [--no-open]
velora sync [--project DIR]
velora scenes [--project DIR] [--json]
velora snapshot --scene ID --url ORIGIN [--time MS] [--project DIR] [--json]
velora load [--scene ID] [--project DIR] [--json]
velora validate [--project DIR] [--composition FILE] [--json]
velora inspect [--project DIR] [--scene ID | --composition FILE] [--json]
velora assets ls [--project DIR] [--json]
velora assets check [--project DIR] [--json]
velora assets add --as SOURCE --id ID [--project DIR] [--json]
velora assets rm --id ID --yes [--project DIR] [--json]
velora export --url URL --output FILE [--fps 24|25|30|50|60|120] [--width N --height N] [--quality draft|standard|master] [--stage-dpr DPR] [--codec h264|hevc|vp9|av1|prores4444|gif] [--motion-blur DEG] [--transparent] [--poster MS] [--audio FILE] [--captions FILE] [--project DIR] [--json]
velora doctor [--project DIR] [--url ORIGIN] [--json]
velora render --composition FILE --frame N --out PNG [--url ORIGIN] [--no-cache] [--project DIR] [--json]
velora render --composition FILE --out VIDEO [--preset ID] [--quality Q] [--stage-dpr DPR] [--codec C] [--motion-blur DEG] [--aspects 16:9,9:16] [--poster MS] [--parallel N] [--fps N] [--width N --height N] [--no-cache] [--no-stream] [--project DIR] [--json]
velora frames --composition FILE --out DIR [--every N | --at MS,...] [--contact-sheet [--columns N]] [--url ORIGIN] [--project DIR] [--json]
velora deliver --composition FILE --targets youtube,reels,website-hero,... [--out DIR] [--quality Q] [--stage-dpr DPR] [--parallel N] [--url ORIGIN] [--project DIR] [--json]
velora shot --scene ID --time MS --out PNG [--quality Q] [--stage-dpr DPR] [--motion-blur DEG] [--fps N] [--transparent] [--finish] [--url ORIGIN] [--project DIR] [--json]
velora depth resolve --scene ID [--url ORIGIN] [--write] [--project DIR] [--json]
velora check --frames DIR [--budget-ms MS] [--project DIR] [--json]
velora check --video FILE [--manifest FILE] [--budget-ms MS] [--project DIR] [--json]
velora audio ls --composition FILE [--project DIR] [--json]
velora audio beats (--file AUDIO | --composition FILE) [--write-markers] [--project DIR] [--json]
velora compose snap --composition FILE [--to beats|downbeats] [--tolerance MS] [--write] [--project DIR] [--json]
velora compose edit --composition FILE --ops FILE|- [--expect-sha SHA] [--write] [--project DIR] [--json]
velora review --composition FILE [--platform ID] [--project DIR] [--json]
velora audio check --composition FILE [--project DIR] [--json]
velora captions validate --file FILE [--project DIR] [--json]
velora captions check --composition FILE [--project DIR] [--json]
velora brand init [--from-css FILE] [--name NAME] [--project DIR] [--json]
velora brand check [--project DIR] [--json]
velora templates ls [--category C] [--tag T] [--aspect A] [--json]
velora templates show --id ID [--json]
velora templates check [--id ID] [--json]
velora new scene --template ID --id SLUG [--component PATH#EXPORT | --route /PATH] [--set KEY=VALUE]... [--aspect A] [--stage PRESET|WxH@DPR] [--duration MS] [--title T] [--project DIR] [--json]
velora new video --blueprint ID --id SLUG [--component PATH#EXPORT | --route /PATH] [--aspect A] [--stage PRESET|WxH@DPR] [--title T] [--project DIR] [--json]
velora transitions ls [--json]
velora transitions describe --type TYPE [--json]
velora prompts ls [--json]
velora prompts show --id ID [--json]
velora create DIR [--name NAME] [--blueprint ID] [--json]
velora studio --site URL [--port P] [--check] [--edit [--scene ID] [--read-only]] [--project DIR] [--json]
velora studio init --site URL [--project DIR] [--json]
velora edit ls --scene ID [--at MS] [--project DIR] [--json]
velora edit apply --scene ID --ops FILE|- [--expect-sha SHA] [--write] [--project DIR] [--json]
velora edit key --scene ID --track REF --at MS --value V [--ease E] [--expect-sha SHA] [--write] [--project DIR] [--json]
velora edit ease --scene ID --track REF --at MS --ease E [--expect-sha SHA] [--write] [--project DIR] [--json]
velora edit paste --scene ID --from FILE --at MS [--onto SURFACE] [--expect-sha SHA] [--write] [--project DIR] [--json]
velora edit [--scene ID | --composition FILE] [--port P] [--read-only] [--no-open] [--url ORIGIN] [--project DIR] [--json]
velora skills install (--dir PATH | --agent claude|generic) [--agent claude|codex|cursor|generic] [--source PATH] [--json]
velora skills ls [--dir PATH] [--source PATH] [--json]
velora skills check [--dir PATH] [--source PATH] [--json]

After installing velora locally, run npx velora init (or npx velora init) in your React DOM app (React 18.2+ or 19). Next.js and Vite have automatic connections; other hosts get a portable React wrapper.
--package is optional when Velora is already installed; it accepts a local .tgz for setup.
init preserves the existing root/providers and creates VELORA.md for your coding agent.
Add --url to initialize and open in one command.
open reuses your running dev server (APP_PORT / PORT / 5173); it never starts another server.
--no-open verifies and prints the preview URL without launching a browser.
--json prints the canonical command result for scripts.
Every command supports --help (for example: velora export --help). Commands never
prompt for input; pipes and NO_COLOR stay plain. Exit 0 on success, 1 on
operational failure (see issues[].code/hint with --json), 2 on usage errors.
`;
const commandUsage: Record<string, string> = {
  guide: "velora guide [--json]\n\nPrint the versioned authoring guide: cinematic concepts, workflow and API.\n--json prints the canonical guide document plus cliVersion and the commands[] index.",
  init: "velora init [--adapter auto|react] [--project DIR] [--package TARBALL] [--url ORIGIN] [--no-open] [--json]\n\nInitialize the project connection and create VELORA.md for the coding agent.\n--adapter react selects the portable connection explicitly. --package accepts a local .tgz.",
  open: "velora open [--scene ID] [--project DIR] [--url ORIGIN] [--no-open] [--json]\n\nVerify the running dev server (APP_PORT / PORT / 5173) and print or open the preview URL.\n--scene ID opens that scene directly. --no-open verifies without launching a browser.",
  sync: "velora sync [--project DIR] [--json]\n\nRefresh the scene registry after adding or removing recipe/component files.",
  scenes: "velora scenes [--project DIR] [--json]\n\nList the validated scene recipes in the project catalog.",
  load: "velora load [--scene ID] [--project DIR] [--json]\n\nLoad one scene recipe source (without --scene, report project status).",
  validate: "velora validate [--project DIR] [--composition FILE] [--json]\n\nValidate the project, scene recipes and bindings; with --composition, validate that timeline plus assets, audio, captions and transitions.\nReports actionable diagnostics with stable codes.",
  inspect: "velora inspect [--project DIR] [--scene ID | --composition FILE] [--json]\n\nInspect the project, one scene or one composition file without mutating anything.\nWithout flags, report project identity plus recipe/asset counts.",
  assets: "velora assets ls [--project DIR] [--json]\nvelora assets check [--project DIR] [--json]\nvelora assets add --as SOURCE --id ID [--project DIR] [--json]\nvelora assets rm --id ID --yes [--project DIR] [--json]\n\nManage project assets in assets/ (list, check, add a file under an ID, remove with confirmation).",
  snapshot: "velora snapshot --scene ID --url ORIGIN [--time MS] [--project DIR] [--json]\n\nCapture one frame PNG into the scene recipe at --time milliseconds (default midpoint).",
  export: "velora export --url URL --output FILE [--fps 24|25|30|50|60|120] [--width N --height N] [--quality draft|standard|master] [--stage-dpr DPR] [--codec h264|hevc|vp9|av1|prores4444|gif] [--motion-blur DEG [--motion-samples N]] [--transparent] [--gif-fps N] [--poster MS] [--audio FILE] [--captions FILE] [--project DIR] [--json]\n\nRender the live scene to a project-relative video through the capture bridge.\n--quality master supersamples 2x and adds 180-degree motion blur; --codec picks the container (.mp4 .webm .mov .gif); --transparent needs vp9 or prores4444.\nOutput is BT.709-tagged.\n--audio mixes a project-relative audio file; --captions burns a project-relative .srt/.vtt file.\nRequires FFmpeg and Playwright Chromium; does not start the app server.",
  doctor: "velora doctor [--project DIR] [--url ORIGIN] [--json]\n\nCheck Node, npm package, React, toolkit, scene catalog, FFmpeg and Chromium.\n--url also probes dev-server reachability. Exit 0 when every check passes, 1 otherwise.",
  render: "velora render --composition FILE [--frame N | --time MS] --out PNG [--stage-dpr DPR] [--url ORIGIN] [--no-cache] [--cache-dir DIR] [--project DIR] [--json]\nvelora render --composition FILE --out VIDEO [--preset ID] [--quality draft|standard|master] [--stage-dpr DPR] [--codec h264|hevc|vp9|av1|prores4444|gif] [--motion-blur DEG [--motion-samples N]] [--transparent] [--gif-fps N] [--aspects 16:9,9:16,1:1] [--poster MS] [--parallel 1-8] [--fps 24|25|30|50|60|120] [--width N --height N] [--no-cache] [--no-stream] [--project DIR] [--json]\n\nRender one exact timeline frame to PNG plus a manifest, or the whole timeline to video.\nFrame mode needs exactly one of --frame/--time with a .png --out; video mode needs a .mp4, .webm, .mov or .gif --out.\n--preset applies a delivery target (explicit flags win) and reports budget warnings.\n--json streams newline-delimited progress lines ending with the result envelope (--no-stream prints only the envelope).",
  frames: "velora frames --composition FILE --out DIR [--every N | --at MS,...] [--contact-sheet [--columns N]] [--url ORIGIN] [--no-cache] [--cache-dir DIR] [--project DIR] [--json]\n\nExtract a PNG sequence plus manifest.json. Defaults to one frame per second.\nExactly one of --every (frame step) or --at (comma-separated milliseconds) may be given.",
  shot: "velora shot --scene ID --time MS --out PNG [--quality draft|standard|master] [--stage-dpr DPR] [--motion-blur DEG [--motion-samples N]] [--fps N] [--transparent] [--finish] [--url ORIGIN] [--project DIR] [--json]\n\nCapture one still from a single scene without a composition.\n--quality and --motion-blur preview export finishing on one frame; --finish adds the look's export finishing (bloom, halation, aberration, sharpen, LUT).",
  depth: "velora depth resolve --scene ID [--url ORIGIN] [--write] [--project DIR] [--json]\n\nOpen the live scene in Chromium, classify its layers at time zero and freeze their anchor or selector, tier and elevation. Dry run unless --write is given.",
  check: "velora check --frames DIR [--budget-ms MS] [--project DIR] [--json]\nvelora check --video FILE [--manifest FILE] [--budget-ms MS] [--project DIR] [--json]\n\nRun automated visual checks over rendered evidence (technical checks only, never artistic scores).\nExactly one of --frames or --video is required; --manifest cross-checks video records.",
  audio: "velora audio ls --composition FILE [--project DIR] [--json]\nvelora audio check --composition FILE [--project DIR] [--json]\nvelora audio beats (--file AUDIO | --composition FILE) [--write-markers] [--project DIR] [--json]\n\nbeats detects tempo, beats and 4/4 downbeats in a music bed; --write-markers stores them on the composition for compose snap.\nList composition audio tracks with frame-snapped placement, or validate them\nagainst discovered assets (existence, type, size, codec, fades, ducking).",
  captions: "velora captions validate --file FILE [--project DIR] [--json]\nvelora captions check --composition FILE [--project DIR] [--json]\n\nValidate a .srt/.vtt file, or check a composition's captions against its timeline span.",
  compose: "velora compose edit --composition FILE --ops FILE|-\nvelora compose trim --composition FILE --id ID --edge in|out --delta MS [--ripple]\nvelora compose move --composition FILE --id ID (--at MS | --before ID | --last)\nvelora compose split --composition FILE --id ID --at MS\nvelora compose transition --composition FILE --id ID (--type TYPE --duration MS [--direction DIR] | --remove)\nvelora compose snap --composition FILE [--to beats|downbeats] [--tolerance MS]\n\nAll commands accept --write, --project DIR and --json. Edits print a dry-run diff and accept --expect-sha SHA.\nSnap moves cuts to nearby beats (default 120 ms tolerance). Add beat markers with velora audio beats --composition FILE --write-markers.",
  review: "velora review --composition FILE [--platform ID] [--project DIR] [--json]\n\nAdvisory editorial review: hook in the first 2 s, shot length for the platform's pacing, reading time, end-card hold,\neye-trace and match-cut continuity, camera direction, loop seams and off-beat cuts. Findings are advice for a human, never errors.",
  brand: "velora brand init [--from-css FILE] [--name NAME] [--project DIR] [--json]\nvelora brand check [--project DIR] [--json]\n\nScaffold velora.brand.json (colors, gradients, fonts, radius, voice, motion personality calm|crisp|playful|bold), optionally seeded from a stylesheet's CSS custom properties, or validate it.\nEvery kit component and motion-graphics template reads these tokens at render time.",
  templates: "velora templates ls [--category C] [--tag T] [--aspect A] [--json]\nvelora templates show --id ID [--json]\nvelora templates check [--id ID] [--json]\n\nBrowse the shipped camera templates and blueprints, show one with its params and craft notes, or certify framing for every aspect and intensity.\nTemplates are starting points: velora new copies plain, editable source into your project.",
  new: "velora new scene --template ID --id SLUG [--component PATH#EXPORT | --route /PATH] [--set KEY=VALUE]... [--aspect 16:9|21:9|1:1|4:5|9:16] [--stage PRESET|WxH@DPR] [--duration MS] [--title T] [--project DIR] [--json]\nvelora new video --blueprint ID --id SLUG [--component PATH#EXPORT | --route /PATH] [--aspect A] [--stage PRESET|WxH@DPR] [--title T] [--project DIR] [--json]\n\nScaffold a templated scene (recipe JSON + binding) or a blueprint composition with its scene pairs. Create-only: existing files are never overwritten.\n--component slots a real component (default export when #EXPORT is omitted); --route frames a page of the running app; neither writes a placeholder.\n--set may repeat (for example --set intensity=dramatic --set lens=35).",
  transitions: "velora transitions ls [--json]\nvelora transitions describe --type TYPE [--json]\n\nList the entering-side transition catalog, or show one transition with example tracks.\nTransitions declare segment entrances; builders emit tracks to paste into recipe motion.",
  deliver: "velora deliver --composition FILE --targets LIST [--out DIR] [--quality draft|standard|master] [--stage-dpr DPR] [--parallel N] [--no-cache] [--no-stream] [--url ORIGIN] [--project DIR] [--json]\n\nRender every launch asset from one composition into a fresh directory (default deliverables/<id>).\nTargets: youtube, x, x-square, linkedin, reels, instagram-feed, tiktok, shorts, website-hero, readme-gif, og-image, product-hunt (or any delivery preset id).\nEach video uses its preset (size, codec, quality, loudness) and steps rate control until it fits the preset's size budget; website-hero adds an MP4 fallback,\na JPEG poster, embed.html and HeroVideo.tsx; og-image and product-hunt add exact-size stills. deliverables.json records files, SHAs, sizes and warnings.",
  studio: "velora studio --site URL [--port P] [--check] [--project DIR] [--json]\nvelora studio init --site URL [--project DIR] [--json]\n\nAny-site mode for non-React sites (Astro, SvelteKit, Rails, Django, static HTML): a managed studio in your user cache\n(React and Vite never enter your project) served at <origin>/__velora/, with every other path proxied to your site's\nloopback dev server so routes frame same-origin. Scenes, compositions and assets stay in this project.\nRuns in the foreground until Ctrl-C; --check starts it, verifies studio, proxy and framing, then stops.\nRoute-level shots only: the site's own animations are frozen; drive states through routes or query params.",
  edit: "velora edit depth --scene ID --surface ID --mode auto|rules|off [--intensity subtle|standard|dramatic] [--expect-sha SHA] [--write] [--project DIR] [--json]\nvelora edit stage --scene ID (--preset PRESET | --size WxH@DPR) [--expect-sha SHA] [--write] [--project DIR] [--json]\nvelora edit ls --scene ID [--at MS] [--project DIR] [--json]\nvelora edit apply --scene ID --ops FILE|- [--expect-sha SHA] [--write] [--project DIR] [--json]\nvelora edit key --scene ID --track REF --at MS --value V [--ease E] [--expect-sha SHA] [--write] [--project DIR] [--json]\nvelora edit ease --scene ID --track REF --at MS --ease E [--expect-sha SHA] [--write] [--project DIR] [--json]\nvelora edit paste --scene ID --from FILE --at MS [--onto SURFACE] [--expect-sha SHA] [--write] [--project DIR] [--json]\nvelora edit source outline [--scene ID] [--file FILE] [--json]\nvelora edit source wrap --file FILE --node PATH --id ID [--scene ID] [--content] [--write]\nvelora edit source group --file FILE --nodes PATH,PATH --id ID [--scene ID] [--write]\nvelora edit source expose --file FILE --node PATH --id ID --prop NAME [--options A,B] [--scene ID] [--write]\nvelora edit [--scene ID | --composition FILE] [--port P] [--read-only] [--no-open] [--url ORIGIN] [--project DIR] [--json]\n\nSurgical, diffable scene edits with exact undo, through the same EditOp vocabulary the studio editor uses.\nls lists tracks, clips, links, constraints and keyframes (--at adds evaluated values). apply, key and ease are dry runs:\nthey print the diff, labels and the inverse batch; --write writes once, compare-and-swap guarded (--expect-sha fails fast if the file changed).\nTrack refs: camera.z, focus.distance, <surface>.<prop>, style:<surface>.--name, channel:<id>, each with an optional @<clip>.\npaste applies a keyframe clipboard copied in the studio editor (application/x-velora-keyframes+json) at --at, optionally onto another surface.\nSource mutations show diffs by default. On --write, --expect-sha and --expect-recipe-sha can pin the reviewed revisions.\n--ops - reads the batch from stdin; an envelope's inverse can be applied directly to undo.\nWithout a subcommand, edit verifies the dev server, starts the loopback edit bridge (token in the URL fragment) and opens the editor; Ctrl-C stops it.",
  create: "velora create DIR [--name NAME] [--blueprint ID] [--json]\n\nWrite a starter launch studio into a new directory: a blank Vite React host with a branded landing page, velora.brand.json,\nand npm scripts (velora:setup runs init, installs the skills and scaffolds the blueprint, default launch-film-30s).\nFor teams without a React app; film an existing non-React site with velora studio --site.",
  prompts: "velora prompts ls [--json]\nvelora prompts show --id ID [--json]\n\nList the agent prompt library (launch film, feature drop, website hero loop, vertical teaser, cinematic dashboard, changelog, Product Hunt kit),\nor print one prompt to paste into your coding agent. Replace each <placeholder> before sending it.",
  skills: "velora skills install --dir PATH [--agent claude|codex|cursor|generic] [--source PATH] [--json]\nvelora skills ls [--dir PATH] [--source PATH] [--json]\nvelora skills check [--dir PATH] [--source PATH] [--json]\n\nInstall the Velora skills library (idempotent; differing files are ERR_SKILL_CONFLICT), list available/installed skills with version drift, or check front-matter and cross-links.\n--agent prints the registration snippet for that agent without writing config files.",
};
function commandHelpText(command: string): string {
  const entry = CLI_COMMANDS.find((item) => item.name === command);
  const body = commandUsage[command] ?? usage;
  return `${VELORA_BRAND.title}\n${VELORA_BRAND.url}\n\n${body}\n\nSkill: ${entry?.skill ?? "velora-debug"}\nExit 0 on success, 1 on operational failure, 2 on usage errors. Add --json for machine-readable output.\n`;
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
    ? `Project ${result.data.integration?.kind === "react" ? "connection generated" : "ready"}: ${result.data.project.entry}${result.data.changed ? " (initialized)" : ""}.\nUse your running dev server, or start it with npm run dev. Then run npx velora open --url <origin printed by your app>.`
    : "Project command completed.");
  const handoff = result.data.handoff;
  const next = handoff
    ? `\nAgent handoff: ${handoff.path}\nCopy this prompt into your coding agent (replace <page route or component path>):\n${handoff.prompt}`
    : "\nScene authoring: run npx velora guide before composing animations.";
  const warnings = result.warnings?.map(normalizeIssue);
  return {
    code: 0,
    stdout: (json
      ? JSON.stringify({ success: true, command, data: result.data, ...(warnings?.length ? { warnings } : {}), ...(result.next ? { next: result.next } : {}) })
      : `${VELORA_BRAND.title}\n${VELORA_BRAND.url}\n${message}${result.data.integration ? "\n" + result.data.integration.instructions : ""}${next}`) + "\n",
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
      : "No local scenes found. Add a recipe and matching component in src/velora/scenes.");
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
  if (result.success) return `${VELORA_BRAND.title}\nDoctor: every check passed.\n${lines.join("\n")}`;
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
    // Optional codecs are informational: only h264 is required.
    if (capture.encoders) {
      const available = Object.entries(capture.encoders).filter(([, ok]) => ok).map(([codec]) => codec);
      const missing = Object.entries(capture.encoders).filter(([, ok]) => !ok).map(([codec]) => codec);
      checks.push({ id: "codecs", label: "Video codecs", pass: true, detail: `Available: ${available.join(", ") || "none"}${missing.length ? `. Unavailable: ${missing.join(", ")} (ERR_CODEC_UNAVAILABLE if requested)` : ""}.` });
    }
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
function templateOutput(result: TemplateCommandResult, json: boolean, human: (data: never) => string): CliResult {
  if (!result.success)
    return { code: 1, stdout: "", stderr: (json ? JSON.stringify(result) : result.issues.map(humanIssue).join("\n")) + "\n" };
  const warnings = result.warnings ?? [];
  return {
    code: 0,
    stdout: (json ? JSON.stringify(result) : human(result.data as never) + (result.next?.length ? "\n\nNext:\n" + result.next.map(step => "  " + step).join("\n") : "")) + "\n",
    stderr: !json && warnings.length ? warnings.map(humanIssue).join("\n") + "\n" : "",
  };
}
// Templates and new share one flag grammar; --set is the only repeatable flag.
function parseTemplateArgs(command: string, args: string[], subs: Record<string, string[]>, fail: (message: string, code?: string, name?: string) => CliResult, booleanFlags: string[] = []):
  { sub: string; flags: Map<string, string | true>; sets: Record<string, string> } | { failed: CliResult } {
  const [sub, ...rest] = args;
  if (!sub || sub.startsWith("--")) return { failed: fail(`${command} requires a subcommand: ${Object.keys(subs).join(", ")}.`, "ERR_MISSING_VALUE", command) };
  if (!Object.hasOwn(subs, sub)) return { failed: fail(`Unknown ${command} subcommand: ${sub}. Expected ${Object.keys(subs).join(" or ")}.`, "ERR_UNKNOWN_COMMAND", command) };
  const flags = new Map<string, string | true>();
  const sets: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!subs[sub].includes(flag)) return { failed: fail(`Unknown option: ${flag}`, "ERR_UNKNOWN_OPTION", command) };
    if (flag === "--json") { flags.set(flag, true); continue; }
    if (booleanFlags.includes(flag)) {
      if (flags.has(flag)) return { failed: fail(`Duplicate option: ${flag}`, "ERR_DUPLICATE_OPTION", command) };
      flags.set(flag, true);
      continue;
    }
    const value = rest[++i];
    if (value === undefined || value.startsWith("--")) return { failed: fail(`Missing value for ${flag}`, "ERR_MISSING_VALUE", command) };
    if (flag === "--set") {
      const at = value.indexOf("=");
      if (at < 1) return { failed: fail(`--set expects KEY=VALUE, got ${value}.`, "ERR_MISSING_VALUE", command) };
      sets[value.slice(0, at)] = value.slice(at + 1);
      continue;
    }
    if (flags.has(flag)) return { failed: fail(`Duplicate option: ${flag}`, "ERR_DUPLICATE_OPTION", command) };
    flags.set(flag, value);
  }
  return { sub, flags, sets };
}
// audio beats, compose snap and review share one flag grammar with boolean --write/--write-markers.
async function runEditorialCommand(command: string, args: string[], environment: Environment, manager: EditorialManager, fail: (message: string, code?: string, name?: string) => CliResult): Promise<CliResult> {
  const grammar: Record<string, { sub?: string; flags: string[]; booleans: string[] }> = {
    audio: { sub: "beats", flags: ["--file", "--composition", "--project"], booleans: ["--write-markers", "--json"] },
    compose: { sub: "snap", flags: ["--composition", "--to", "--tolerance", "--project"], booleans: ["--write", "--json"] },
    review: { flags: ["--composition", "--platform", "--project"], booleans: ["--json"] },
  };
  const spec = grammar[command];
  const rest = spec.sub ? args.slice(1) : args;
  if (spec.sub && args[0] !== spec.sub) return fail(`${command} requires the subcommand ${spec.sub}.`, "ERR_MISSING_VALUE", command);
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (spec.booleans.includes(flag)) { flags.set(flag, true); continue; }
    if (!spec.flags.includes(flag)) return fail(`Unknown option: ${flag}`, "ERR_UNKNOWN_OPTION", command);
    if (flags.has(flag)) return fail(`Duplicate option: ${flag}`, "ERR_DUPLICATE_OPTION", command);
    const value = rest[++i];
    if (!value || value.startsWith("--")) return fail(`Missing value for ${flag}`, "ERR_MISSING_VALUE", command);
    flags.set(flag, value);
  }
  const json = flags.has("--json");
  const value = (flag: string) => flags.get(flag) as string | undefined;
  const context = { root: value("--project") ?? environment.root };
  let result: EditorialCommandResult;
  if (command === "audio") {
    if (!flags.has("--file") && !flags.has("--composition")) return fail("audio beats needs --file or --composition.", "ERR_MISSING_VALUE", command);
    if (flags.has("--write-markers") && !flags.has("--composition")) return fail("--write-markers needs --composition.", "ERR_INVALID_FLAG_COMBINATION", command);
    result = await manager("audio-beats", { ...(value("--file") ? { file: value("--file") } : {}), ...(value("--composition") ? { composition: value("--composition") } : {}), ...(flags.has("--write-markers") ? { writeMarkers: true } : {}) }, context);
  } else if (command === "compose") {
    if (!flags.has("--composition")) return fail("compose snap needs --composition.", "ERR_MISSING_VALUE", command);
    const to = value("--to") ?? "beats";
    if (to !== "beats" && to !== "downbeats") return fail("--to takes beats or downbeats.", "invalid-input", command);
    const tolerance = value("--tolerance");
    if (tolerance !== undefined && !/^\d+$/.test(tolerance)) return fail("--tolerance expects whole milliseconds.", "invalid-input", command);
    result = await manager("compose-snap", { composition: value("--composition"), to, ...(tolerance ? { tolerance: Number(tolerance) } : {}), ...(flags.has("--write") ? { write: true } : {}) }, context);
  } else {
    if (!flags.has("--composition")) return fail("review needs --composition.", "ERR_MISSING_VALUE", command);
    result = await manager("review", { composition: value("--composition"), ...(value("--platform") ? { platform: value("--platform") } : {}) }, context);
  }
  return templateOutput(result as unknown as TemplateCommandResult, json, (data: Record<string, unknown>) => {
    if (command === "audio") return `${data.file}: ${data.bpm} BPM (confidence ${data.confidence}), ${(data.beats as unknown[]).length} beats, ${(data.downbeats as unknown[]).length} downbeats.${data.markersWritten !== undefined ? ` Wrote ${data.markersWritten} beat markers.` : ""}`;
    if (command === "compose") {
      const changes = data.changes as { id: string; field: string; from: number; to: number }[];
      return changes.length ? `${data.written ? "Applied" : "Would apply"} ${changes.length} change${changes.length === 1 ? "" : "s"}:\n${changes.map(change => `  ${change.id}.${change.field}: ${change.from} -> ${change.to}`).join("\n")}${(data.unsnapped as string[]).length ? `\nNo beat within tolerance for: ${(data.unsnapped as string[]).join(", ")}` : ""}`
        : "Every cut already sits on a beat.";
    }
    const advisories = data.advisories as { code: string; message: string }[];
    return advisories.length ? `${advisories.length} editorial advisor${advisories.length === 1 ? "y" : "ies"} (review by eye):\n${advisories.map(item => `  ${item.code}: ${item.message}`).join("\n")}` : "No editorial advisories. Still watch the cut.";
  });
}
async function runBrandCommand(args: string[], environment: Environment, manager: BrandManager, fail: (message: string, code?: string, name?: string) => CliResult): Promise<CliResult> {
  const parsed = parseTemplateArgs("brand", args, { init: ["--from-css", "--name", "--project", "--json"], check: ["--project", "--json"] }, fail);
  if ("failed" in parsed) return parsed.failed;
  const { sub, flags } = parsed;
  const json = flags.has("--json");
  const context = { root: (flags.get("--project") as string | undefined) ?? environment.root };
  const result: BrandCommandResult = sub === "init"
    ? await manager("brand-init", { ...(flags.has("--from-css") ? { fromCss: flags.get("--from-css") } : {}), ...(flags.has("--name") ? { name: flags.get("--name") } : {}) }, context)
    : await manager("brand-check", {}, context);
  return templateOutput(result as unknown as TemplateCommandResult, json, (data: { file: string; brand: { name: string; motion: string; colors: Record<string, string> } }) =>
    `${sub === "init" ? "Wrote" : "Valid"} ${data.file}: ${data.brand.name}, motion ${data.brand.motion}, accent ${data.brand.colors.accent}.`);
}
async function runTemplatesCommand(args: string[], environment: Environment, manager: TemplateManager, fail: (message: string, code?: string, name?: string) => CliResult): Promise<CliResult> {
  const parsed = parseTemplateArgs("templates", args, { ls: ["--category", "--tag", "--aspect", "--json"], show: ["--id", "--json"], check: ["--id", "--json"] }, fail);
  if ("failed" in parsed) return parsed.failed;
  const { sub, flags } = parsed;
  const json = flags.has("--json");
  const value = (flag: string) => flags.get(flag) as string | undefined;
  if (sub === "show" && !flags.has("--id")) return fail("templates show requires --id.", "ERR_MISSING_VALUE", "templates");
  const context = { root: environment.root };
  if (sub === "ls")
    return templateOutput(await manager("list-templates", { category: value("--category"), tag: value("--tag"), aspect: value("--aspect") }, context), json,
      (data: { templates: { id: string; title: string; summary: string }[]; blueprints: { id: string; title: string }[] }) =>
        ["Templates (velora new scene --template ID):", ...data.templates.map(t => `  ${t.id.padEnd(18)} ${t.title} — ${t.summary}`),
          "", "Blueprints (velora new video --blueprint ID):", ...data.blueprints.map(b => `  ${b.id.padEnd(22)} ${b.title}`)].join("\n"));
  if (sub === "show")
    return templateOutput(await manager("show-template", { id: value("--id") }, context), json, (data: Record<string, unknown>) => JSON.stringify(data, null, 2));
  return templateOutput(await manager("check-templates", flags.has("--id") ? { id: value("--id") } : {}, context), json,
    (data: { templates: { id: string }[] }) => `Certified ${data.templates.length} template${data.templates.length === 1 ? "" : "s"} across every supported aspect and intensity: ${data.templates.map(t => t.id).join(", ")}.`);
}
async function runNewCommand(args: string[], environment: Environment, manager: TemplateManager, fail: (message: string, code?: string, name?: string) => CliResult): Promise<CliResult> {
  const shared = ["--id", "--component", "--route", "--aspect", "--stage", "--title", "--project", "--json"];
  const parsed = parseTemplateArgs("new", args, { scene: ["--template", "--set", "--duration", ...shared], video: ["--blueprint", ...shared] }, fail);
  if ("failed" in parsed) return parsed.failed;
  const { sub, flags, sets } = parsed;
  const json = flags.has("--json");
  const value = (flag: string) => flags.get(flag) as string | undefined;
  const source = sub === "scene" ? "--template" : "--blueprint";
  if (!flags.has(source) || !flags.has("--id")) return fail(`new ${sub} requires ${source} and --id.`, "ERR_MISSING_VALUE", "new");
  if (flags.has("--component") && flags.has("--route")) return fail("Pass either --component or --route, not both.", "ERR_INVALID_FLAG_COMBINATION", "new");
  const duration = value("--duration");
  if (duration !== undefined && !/^\d+$/.test(duration)) return fail("--duration expects whole milliseconds.", "ERR_MISSING_VALUE", "new");
  const context = { root: value("--project") ?? environment.root };
  const common = { id: value("--id"), ...(flags.has("--component") ? { component: value("--component") } : {}), ...(flags.has("--route") ? { route: value("--route") } : {}),
    ...(flags.has("--aspect") ? { aspect: value("--aspect") } : {}), ...(flags.has("--stage") ? { stage: value("--stage") } : {}),
    ...(flags.has("--title") ? { title: value("--title") } : {}) };
  const result = sub === "scene"
    ? await manager("new-scene", { template: value("--template"), ...common, set: sets, ...(duration !== undefined ? { durationMs: Number(duration) } : {}) }, context)
    : await manager("new-video", { blueprint: value("--blueprint"), ...common }, context);
  return templateOutput(result, json, (data: { files: string[] }) => `Created (yours to edit):\n${data.files.map(file => "  " + file).join("\n")}`);
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
      : TRANSITION_CATALOG.map((t) => `${t.type}\t${t.mode}\t${t.description}`).join("\n")) + "\n", stderr: "" };
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
// Prompts are pure library data: no project I/O.
async function runPromptsCommand(
  args: string[],
  fail: (message: string, code?: string, name?: string) => CliResult,
): Promise<CliResult> {
  const [sub, ...rest] = args;
  if (!sub || sub.startsWith("--")) return fail("prompts requires a subcommand: ls, show.", "ERR_MISSING_VALUE", "prompts");
  if (sub !== "ls" && sub !== "show") return fail(`Unknown prompts subcommand: ${sub}. Expected ls or show.`, "ERR_UNKNOWN_COMMAND", "prompts");
  const allowed = sub === "ls" ? ["--json"] : ["--id", "--json"];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!allowed.includes(flag)) return fail(`Unknown option: ${flag}`, "ERR_UNKNOWN_OPTION", "prompts");
    if (flags.has(flag)) return fail(`Duplicate option: ${flag}`, "ERR_DUPLICATE_OPTION", "prompts");
    if (flag === "--json") flags.set(flag, true);
    else {
      const value = rest[++i];
      if (!value || value.startsWith("--")) return fail(`Missing value for ${flag}`, "ERR_MISSING_VALUE", "prompts");
      flags.set(flag, value);
    }
  }
  const json = flags.has("--json");
  if (sub === "ls") {
    const prompts = PROMPT_LIBRARY.map(({ id, title, intent, templates, skills, featured }) => ({ id, title, intent, templates, skills, featured }));
    const result = { success: true as const, data: { prompts } };
    return { code: 0, stdout: (json ? JSON.stringify(withCommand(result, "prompts"))
      : PROMPT_LIBRARY.map(p => `${p.id}\t${p.title}\t${p.intent}`).join("\n")) + "\n", stderr: "" };
  }
  if (!flags.has("--id")) return fail("prompts show requires --id.", "ERR_MISSING_VALUE", "prompts");
  const id = flags.get("--id") as string;
  const prompt = findPrompt(id);
  if (!prompt) return operationalFailure("prompts", [{ code: "ERR_PROMPT_NOT_FOUND", message: `Unknown prompt "${id}". Run velora prompts ls --json for the library.` }], json);
  const result = { success: true as const, data: { ...prompt, placeholders: promptPlaceholders(prompt.text) } };
  return { code: 0, stdout: (json ? JSON.stringify(withCommand(result, "prompts")) : `${prompt.title}\n\n${prompt.text}`) + "\n", stderr: "" };
}
// The starter writes a new directory beside the caller; it needs no initialized project.
async function runCreateCommand(args: string[], environment: Environment, manager: typeof executeCreateCommand, fail: (message: string, code?: string, name?: string) => CliResult): Promise<CliResult> {
  const [dir, ...rest] = args;
  if (!dir || dir.startsWith("--")) return fail("create requires a directory: velora create my-launch.", "ERR_MISSING_VALUE", "create");
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!["--name", "--blueprint", "--json"].includes(flag)) return fail(`Unknown option: ${flag}`, "ERR_UNKNOWN_OPTION", "create");
    if (flags.has(flag)) return fail(`Duplicate option: ${flag}`, "ERR_DUPLICATE_OPTION", "create");
    if (flag === "--json") flags.set(flag, true);
    else {
      const value = rest[++i];
      if (!value || value.startsWith("--")) return fail(`Missing value for ${flag}`, "ERR_MISSING_VALUE", "create");
      flags.set(flag, value);
    }
  }
  const json = flags.has("--json");
  const result = await manager({ dir, ...(flags.has("--name") ? { name: flags.get("--name") as string } : {}), ...(flags.has("--blueprint") ? { blueprint: flags.get("--blueprint") as string } : {}) },
    { root: environment.root, ...(environment.terminal?.version ? { version: environment.terminal.version } : {}) });
  if (!result.success) return { code: 1, stdout: "", stderr: (json ? JSON.stringify(result) : result.issues.map(humanIssue).join("\n")) + "\n" };
  return { code: 0, stdout: (json ? JSON.stringify(result) : `Created ${result.data.dir} (${result.data.files.length} files, blueprint ${result.data.blueprint}). Next:\n${result.data.next.map(step => "  " + step).join("\n")}`) + "\n", stderr: "" };
}
// velora edit: ls/apply/key/ease are dry runs unless --write; without a subcommand it runs the edit bridge
// in the foreground (Ctrl-C stops it), like studio.
async function runEditCommand(args: string[], environment: Environment, manager: typeof executeEditCommand, fail: (message: string, code?: string, name?: string) => CliResult): Promise<CliResult> {
  const grammar: Record<string, { values: string[]; booleans: string[] }> = {
    ls: { values: ["--scene", "--at", "--project"], booleans: ["--json"] },
    apply: { values: ["--scene", "--ops", "--expect-sha", "--label", "--project"], booleans: ["--write", "--json"] },
    key: { values: ["--scene", "--track", "--at", "--value", "--ease", "--expect-sha", "--project"], booleans: ["--write", "--json"] },
    ease: { values: ["--scene", "--track", "--at", "--ease", "--expect-sha", "--project"], booleans: ["--write", "--json"] },
    stage: { values: ["--scene", "--preset", "--size", "--expect-sha", "--project"], booleans: ["--write", "--json"] },
    depth: { values: ["--scene", "--surface", "--mode", "--intensity", "--expect-sha", "--project"], booleans: ["--write", "--json"] },
    paste: { values: ["--scene", "--from", "--at", "--onto", "--expect-sha", "--project"], booleans: ["--write", "--json"] },
    bridge: { values: ["--scene", "--composition", "--port", "--url", "--project"], booleans: ["--read-only", "--no-open", "--json"] },
    preset: { values: ["--scene", "--preset", "--to", "--layer", "--title", "--values", "--at", "--expect-sha", "--label", "--project"], booleans: ["--write", "--json"] },
    source: { values: ["--scene", "--file", "--node", "--nodes", "--id", "--prop", "--options", "--expect-sha", "--expect-recipe-sha", "--project"], booleans: ["--write", "--content", "--json"] },
  };
  const sub = args[0] && !args[0].startsWith("--") ? args[0] : "bridge";
  if (sub === "bridge" && args[0] && !args[0].startsWith("--")) return fail(`Unknown edit subcommand: ${args[0]}.`, "ERR_UNKNOWN_COMMAND", "edit");
  if (!Object.hasOwn(grammar, sub) || (sub === "bridge" && args[0] === "bridge")) return fail(`Unknown edit subcommand: ${sub}. Expected ls, apply, key, ease, paste, stage, depth, preset, source, or flags to start the bridge.`, "ERR_UNKNOWN_COMMAND", "edit");
  // velora edit preset ls|show|save|apply [flags]
  const action = sub === "preset" ? (args[1] && !args[1].startsWith("--") ? args[1] : "ls") : undefined;
  if (action !== undefined && !["ls", "show", "save", "apply"].includes(action)) return fail(`Unknown preset action: ${action}. Expected ls, show, save or apply.`, "ERR_UNKNOWN_COMMAND", "edit");
  const sourceAction = sub === "source" ? (args[1] && !args[1].startsWith("--") ? args[1] : "outline") : undefined;
  if (sourceAction && !["outline", "wrap", "group", "expose"].includes(sourceAction)) return fail(`Unknown source action: ${sourceAction}. Expected outline, wrap, group or expose.`, "ERR_UNKNOWN_COMMAND", "edit");
  const rest = sub === "bridge" ? args : args.slice((sub === "preset" || sub === "source") && args[1] && !args[1].startsWith("--") ? 2 : 1);
  const spec = grammar[sub];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!spec.values.includes(flag) && !spec.booleans.includes(flag)) return fail(`Unknown option: ${flag}`, "ERR_UNKNOWN_OPTION", "edit");
    if (flags.has(flag)) return fail(`Duplicate option: ${flag}`, "ERR_DUPLICATE_OPTION", "edit");
    if (spec.booleans.includes(flag)) { flags.set(flag, true); continue; }
    const value = rest[++i];
    if (value === undefined || (value.startsWith("--") && flag !== "--value")) return fail(`Missing value for ${flag}`, "ERR_MISSING_VALUE", "edit");
    flags.set(flag, value);
  }
  for (const flag of ["--at", "--port"]) if (flags.has(flag) && !/^\d+(?:\.\d+)?$/.test(flags.get(flag) as string)) return fail(`${flag} must be a nonnegative number.`, "ERR_MISSING_VALUE", "edit");
  const json = flags.has("--json");
  const text = (flag: string) => flags.get(flag) as string | undefined;
  let opsText: string | undefined;
  if (text("--ops") === "-") {
    if (!environment.readStdin) return fail("--ops - needs standard input.", "ERR_MISSING_VALUE", "edit");
    opsText = await environment.readStdin();
  }
  const input = {
    ...(text("--composition") ? { composition: text("--composition") } : {}),
    ...(text("--size") ? { size: text("--size") } : {}),
    ...(sub === "depth" ? { surface: text("--surface"), mode: text("--mode") as DepthConfig["mode"], intensity: text("--intensity") as DepthConfig["intensity"] } : {}),
    ...(text("--scene") ? { scene: text("--scene") } : {}), ...(flags.has("--at") ? { at: Number(text("--at")) } : {}),
    ...(text("--ops") && text("--ops") !== "-" ? { ops: text("--ops") } : {}), ...(opsText !== undefined ? { opsText } : {}),
    ...(text("--expect-sha") ? { expectSha: text("--expect-sha") } : {}), ...(flags.has("--write") ? { write: true } : {}),
    ...(text("--track") ? { track: text("--track") } : {}), ...(text("--value") !== undefined ? { value: text("--value") } : {}),
    ...(text("--ease") ? { ease: text("--ease") } : {}), ...(text("--label") ? { label: text("--label") } : {}),
    ...(text("--from") ? { from: text("--from") } : {}), ...(text("--onto") ? { onto: text("--onto") } : {}),
    ...(flags.has("--port") ? { port: Number(text("--port")) } : {}), ...(flags.has("--read-only") ? { readOnly: true } : {}),
    ...(action ? { action: action as "ls" | "show" | "save" | "apply" } : {}), ...(text("--preset") ? { preset: text("--preset") } : {}), ...(text("--to") ? { to: text("--to") } : {}),
    ...(text("--layer") ? { layer: text("--layer") } : {}), ...(text("--title") ? { title: text("--title") } : {}), ...(text("--values") ? { values: text("--values") as "absolute" | "relative" } : {}),
    ...(sourceAction ? { sourceAction: sourceAction as "outline" | "wrap" | "group" | "expose", file: text("--file"), node: text("--node"), nodes: text("--nodes")?.split(","),
      sourceId: text("--id"), content: flags.has("--content"), prop: text("--prop"), enumOptions: text("--options")?.split(","), expectRecipeSha: text("--expect-recipe-sha") } : {}),
    ...(sub === "bridge" ? { launch: !flags.has("--no-open"), url: text("--url") ?? `http://127.0.0.1:${environment.port ?? "5173"}` } : {}),
  };
  const log = sub === "bridge" && json && environment.emit ? (entry: Record<string, unknown>) => environment.emit!(JSON.stringify({ log: entry }) + "\n") : undefined;
  const result = await manager(sub as EditOperation, input, { root: text("--project") ?? environment.root, ...(environment.terminal?.version ? { version: environment.terminal.version } : {}), ...(log ? { log } : {}) });
  if (!result.success) return { code: 1, stdout: "", stderr: (json ? JSON.stringify(result) : result.issues.map(humanIssue).join("\n")) + "\n" };
  const { server, ...envelope } = result;
  const data = result.data as Record<string, unknown>;
  if (sub === "bridge") {
    const body = (json ? JSON.stringify(envelope) : `Edit bridge ${data.readOnly ? "(read-only) " : ""}listening on ${data.bridge}\n  Editor: ${data.url}\n  Press Ctrl-C to stop.`) + "\n";
    if (!server || !environment.emit) { await server?.stop(); return { code: 0, stdout: body, stderr: "" }; }
    environment.emit(body);
    environment.onShutdown?.(server.stop);
    const exit = await server.closed;
    return { code: exit === 0 || exit === null ? 0 : 1, stdout: "", stderr: "" };
  }
  if (json) return { code: 0, stdout: JSON.stringify(envelope) + "\n", stderr: "" };
  if (sub === "source") {
    const outlines = data.outlines as import("../core/source").SourceDocument[] | undefined;
    const diffs = data.diffs as { diff: string; file: string; git: string }[] | undefined;
    const output = outlines ? outlines.map(outline => `${outline.file} (${outline.sha})\n${outline.nodes.map(node => `  ${node.start.line}:${node.start.column}  ${node.path}${node.text ? `  ${node.text}` : ""}`).join("\n")}`).join("\n")
      : `${data.written ? "Applied source edit" : "Source edit dry run"}\n${data.layoutWarning ? `${data.layoutWarning}\n` : ""}${(diffs ?? []).map(entry => `${entry.file} (${entry.git})\n${entry.diff}`).join("\n")}`;
    return { code: 0, stdout: output + "\n", stderr: "" };
  }
  if (sub === "ls") {
    const tracks = data.tracks as { track: { target: { kind: string; id?: string }; property: string; clip?: string }; keyframes: { atMs: number; value: unknown }[] }[];
    const lines = tracks.map(entry => `${entry.track.target.id ?? entry.track.target.kind}.${entry.track.property}${entry.track.clip ? "@" + entry.track.clip : ""}\t${entry.keyframes.map(frame => `${frame.atMs}ms=${JSON.stringify(frame.value)}`).join("  ")}`);
    return { code: 0, stdout: `${data.path} (sha ${String(data.sha).slice(0, 12)}…, ${data.durationMs}ms)\n${lines.join("\n") || "No tracks."}\n`, stderr: "" };
  }
  const labels = (data.labels as string[]).map(label => "  " + label).join("\n");
  const status = data.written ? `Wrote ${data.path} (sha ${String(data.nextSha).slice(0, 12)}…).` : `Dry run: ${data.path} is unchanged. Add --write to apply (--expect-sha ${data.sha}).`;
  return { code: 0, stdout: `${labels}\n${data.diff || "(no change)"}\n${status}\n`, stderr: "" };
}

async function runCompositionEdit(args: string[], environment: Environment, fail: (message: string, code?: string, name?: string) => CliResult): Promise<CliResult> {
  const commands: Record<string, string[]> = { edit: ["--ops"], trim: ["--id", "--edge", "--delta", "--ripple"], move: ["--id", "--at", "--before", "--last"],
    split: ["--id", "--at", "--new-id"], transition: ["--id", "--type", "--duration", "--direction", "--ease", "--seed", "--sfx", "--remove"] };
  const [sub, ...rest] = args;
  if (!Object.hasOwn(commands, sub)) return fail("Choose compose edit, trim, move, split, transition or snap.", "ERR_UNKNOWN_COMMAND", "compose");
  const allowed = new Set([...commands[sub], "--composition", "--expect-sha", "--project", "--write", "--json"]);
  const switches = new Set(["--write", "--json", "--ripple", "--last", "--remove"]);
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (!allowed.has(key)) return fail(`Unknown option: ${key}`, "ERR_UNKNOWN_OPTION", "compose");
    if (flags.has(key)) return fail(`Duplicate option: ${key}`, "ERR_DUPLICATE_OPTION", "compose");
    const value = switches.has(key) ? "true" : rest[++i];
    if (!value || value.startsWith("--")) return fail(`Missing value for ${key}`, "ERR_MISSING_VALUE", "compose");
    flags.set(key, value);
  }
  const composition = flags.get("--composition"), id = flags.get("--id"), opsFile = flags.get("--ops");
  const missing = !composition ? "--composition" : sub === "edit" ? !opsFile && "--ops" : !id && "--id";
  if (missing) return fail(`compose ${sub} needs ${missing}.`, "ERR_MISSING_VALUE", "compose");
  const number = (flag: string) => Number(flags.get(flag));
  let ops: unknown;
  if (sub === "trim") ops = [{ op: "segment.trim", id, edge: flags.get("--edge"), deltaMs: number("--delta"), mode: flags.has("--ripple") ? "ripple" : "plain" }];
  if (sub === "move") {
    if (["--at", "--before", "--last"].filter(flag => flags.has(flag)).length !== 1)
      return fail("Choose one of --at, --before or --last.", "ERR_INVALID_FLAG_COMBINATION", "compose");
    ops = [flags.has("--at") ? { op: "segment.move", id, atMs: number("--at") } : { op: "segment.reorder", id, beforeId: flags.get("--before") ?? null }];
  }
  if (sub === "split") ops = [{ op: "segment.split", id, atMs: number("--at"), newId: flags.get("--new-id") }];
  if (sub === "transition") {
    const type = flags.get("--type");
    if (flags.has("--remove") && commands.transition.slice(1, -1).some(flag => flags.has(flag)))
      return fail("--remove takes only a segment ID.", "ERR_INVALID_FLAG_COMBINATION", "compose");
    let ease: unknown = flags.get("--ease");
    if (typeof ease === "string" && ease.startsWith("{")) {
      try { ease = JSON.parse(ease); }
      catch { return fail("--ease must be an easing name or JSON object.", "ERR_EDIT_INVALID", "compose"); }
    }
    ops = [flags.has("--remove") ? { op: "transition.remove", segmentId: id } : { op: "transition.set", segmentId: id,
      type, durationMs: number("--duration"), direction: flags.get("--direction"), ease,
      seed: flags.has("--seed") ? number("--seed") : undefined, sfx: flags.get("--sfx") }];
  }
  if (opsFile === "-" && !environment.readStdin) return fail("--ops - needs standard input.", "ERR_MISSING_VALUE", "compose");
  const result = await executeCompositionEdit({ composition: composition!, ops, opsFile: opsFile === "-" ? undefined : opsFile,
    opsText: opsFile === "-" ? await environment.readStdin!() : undefined, expectSha: flags.get("--expect-sha"), write: flags.has("--write") },
  { root: flags.get("--project") ?? environment.root });
  if (!result.success) return { code: 1, stdout: "", stderr: (flags.has("--json") ? JSON.stringify(result) : result.issues.map(humanIssue).join("\n")) + "\n" };
  const { data } = result;
  return { code: 0, stderr: "", stdout: (flags.has("--json") ? JSON.stringify(result) : `${data.written ? "Wrote" : flags.has("--write") ? "No changes to" : "Dry run for"} ${data.path} (base SHA ${data.sha})\n${data.diff || "(no change)"}`) + "\n" };
}
// Any-site mode: `studio init` records the site project; `studio` provisions and runs the managed studio in the
// foreground (Ctrl-C stops it); `--check` starts it, verifies studio, proxy and framing, then stops.
async function runStudioCommand(args: string[], environment: Environment, manager: typeof executeStudioCommand, fail: (message: string, code?: string, name?: string) => CliResult): Promise<CliResult> {
  const init = args[0] === "init";
  const rest = init ? args.slice(1) : args;
  if (!init && rest[0] && !rest[0].startsWith("--")) return fail(`Unknown studio subcommand: ${rest[0]}. Expected init, or flags.`, "ERR_UNKNOWN_COMMAND", "studio");
  const allowed = init ? ["--site", "--project", "--json"] : ["--site", "--port", "--check", "--edit", "--scene", "--read-only", "--project", "--json"];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!allowed.includes(flag)) return fail(`Unknown option: ${flag}`, "ERR_UNKNOWN_OPTION", "studio");
    if (flags.has(flag)) return fail(`Duplicate option: ${flag}`, "ERR_DUPLICATE_OPTION", "studio");
    if (flag === "--json" || flag === "--check" || flag === "--edit" || flag === "--read-only") flags.set(flag, true);
    else {
      const value = rest[++i];
      if (!value || value.startsWith("--")) return fail(`Missing value for ${flag}`, "ERR_MISSING_VALUE", "studio");
      flags.set(flag, value);
    }
  }
  if (flags.has("--port") && !/^\d{2,5}$/.test(flags.get("--port") as string)) return fail("--port must be a TCP port number.", "ERR_MISSING_VALUE", "studio");
  const json = flags.has("--json");
  const operation = init ? "studio-init" : flags.has("--check") || !environment.emit ? "studio-check" : "studio-start";
  if ((flags.has("--scene") || flags.has("--read-only")) && !flags.has("--edit")) return fail("--scene and --read-only need --edit.", "ERR_INVALID_FLAG_COMBINATION", "studio");
  const result = await manager(operation, { ...(flags.has("--site") ? { site: flags.get("--site") as string } : {}), ...(flags.has("--port") ? { port: Number(flags.get("--port")) } : {}),
    ...(flags.has("--edit") ? { edit: true, ...(flags.has("--scene") ? { scene: flags.get("--scene") as string } : {}), ...(flags.has("--read-only") ? { readOnly: true } : {}) } : {}) },
    { root: (flags.get("--project") as string | undefined) ?? environment.root, ...(environment.terminal?.version ? { version: environment.terminal.version } : {}) });
  if (!result.success) return { code: 1, stdout: "", stderr: (json ? JSON.stringify(result) : result.issues.map(humanIssue).join("\n")) + "\n" };
  const { server, ...envelope } = result;
  const human = init
    ? `Recorded ${result.data.site} as this project's site (.velora/project.json). Start the studio: npx velora studio --site ${result.data.site}`
    : `${server ? "Studio running" : "Studio verified"} for ${result.data.site}${result.data.url ? `\n  ${result.data.url}` : ""}`
      + `\n  Workspace: ${result.data.workspace}${result.data.installed ? ` (installed, ${Math.round((result.data.workspaceBytes ?? 0) / 1048576)} MB)` : ""}`
      + (result.data.checks ?? []).map(check => `\n  ${check.pass ? "ok" : "FAIL"} ${check.id}: ${check.detail}`).join("")
      + result.data.warnings.map(warning => `\n  Warning: ${warning.message}`).join("")
      + (result.data.editor ? `\n  Editor: ${result.data.editor}` : "")
      + (server ? "\n  Render with --url " + server.origin + ". Press Ctrl-C to stop." : "");
  const body = (json ? JSON.stringify(envelope) : human) + "\n";
  if (!server) return { code: 0, stdout: body, stderr: "" };
  environment.emit!(body);
  environment.onShutdown?.(server.stop);
  const exit = await server.closed;
  return { code: exit === 0 || exit === null ? 0 : 1, stdout: "", stderr: "" };
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
    // Agents with a verified project convention get it by default; others must name the directory.
    const conventional: Record<string, string> = { claude: ".claude/skills", generic: ".agents/skills" };
    if (!flags.has("--dir")) {
      const agent = flags.get("--agent") as string | undefined;
      if (!agent || !Object.hasOwn(conventional, agent)) return fail("skills install requires --dir (or --agent claude|generic to use the conventional project directory).", "ERR_MISSING_VALUE", "skills");
      flags.set("--dir", conventional[agent]);
    }
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
// Finishing flags shared by export and render (validated by the core schemas).
function finishingInput(flags: Map<string, string | true>) {
  return {
    ...stageDprInput(flags),
    ...(flags.has("--quality") ? { quality: flags.get("--quality") as string } : {}),
    ...(flags.has("--codec") ? { codec: flags.get("--codec") as string } : {}),
    ...(flags.has("--transparent") ? { transparent: true } : {}),
    ...(flags.has("--motion-blur") ? { motionBlur: Number(flags.get("--motion-blur")) } : {}),
    ...(flags.has("--motion-samples") ? { motionSamples: Number(flags.get("--motion-samples")) } : {}),
    ...(flags.has("--gif-fps") ? { gifFps: Number(flags.get("--gif-fps")) } : {}),
    ...(flags.has("--poster") ? { poster: Number(flags.get("--poster")) } : {}),
  } as Record<string, never>;
}
function stageDprInput(flags: Map<string, string | true>) {
  return flags.has("--stage-dpr") ? { stageDpr: StageDprSchema.parse(Number(flags.get("--stage-dpr"))) } : {};
}
function progressCollector(json: boolean, noStream: boolean): { lines: string[]; onProgress?: (done: number, total: number) => void; flush: (body: string) => string } {
  const lines: string[] = [];
  if (!json || noStream) return { lines, onProgress: undefined, flush: (body) => `${body}\n` };
  const started = Date.now();
  return {
    lines,
    onProgress: (done, total) => {
      const elapsed = Math.max(1, Date.now() - started);
      const rate = done / (elapsed / 1000);
      lines.push(JSON.stringify({ type: "progress", phase: "capture", stage: "capture", frame: done, total, pct: total ? Math.round((done / total) * 100) : 100,
        fps: Math.round(rate * 10) / 10, etaMs: rate > 0 ? Math.round(((total - done) / rate) * 1000) : null }));
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
export async function runCli(argv: string[], environment: Environment, execute: Execute = executeProjectCommand, exporter: typeof executeVideoExport = executeVideoExport, recipes: typeof executeRecipeCommand = executeRecipeCommand, snapshotter:typeof executeSceneSnapshot=executeSceneSnapshot, doctor: Doctor = defaultDoctor, renderer: Renderer = executeFrameRender, audioManager?: AudioManager, captionManager?: CaptionManager, videoRenderer?: VideoRenderer, framesRenderer?: FramesRenderer, shotRenderer?: ShotRenderer, checkRunner?: CheckRunner, skillsManager?: SkillsManager, inspectManager?: InspectManager, assetsManager?: AssetsManager, templateManager?: TemplateManager, brandManager?: BrandManager, editorialManager?: EditorialManager, deliverer?: typeof executeDeliver, creator?: typeof executeCreateCommand, studioManager?: typeof executeStudioCommand, editManager?: typeof executeEditCommand): Promise<CliResult> {
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
    if(args.length>1 || (args.length===1 && args[0]!=="--json"))return fail("Usage: velora guide [--json]", "ERR_UNKNOWN_OPTION", "guide");
    const guide=RESOURCES["authoring-guide"]({cliVersion: environment.terminal?.version ?? "development"});
    const text=[guide.purpose,guide.creativeFreedom,...guide.concepts.map(c=>`## ${c.title}\n${c.meaning}\nHow it works: ${c.mechanism}\nCreative choices: ${c.choices}\nWatch for: ${c.pitfalls}\nVerify: ${c.verify}`),"## Workflow\n"+guide.workflow.map((s,i)=>`${i+1}. ${s}`).join("\n"),"## Installed API and defaults\n"+JSON.stringify(guide.capabilities,null,2)].join("\n\n");
    return {code:0,stdout:(args[0]==="--json"?JSON.stringify({...guide,command:"guide"}):`${VELORA_BRAND.title}\n${VELORA_BRAND.url}\n\n${text}`)+"\n",stderr:""};
  }
  const aliases = { init: "init-project", sync: "sync-project", open: "open-preview", load: "load-project", validate: "validate-project" } as const;
  if (command === "depth") {
    const parsed = parseTemplateArgs(command, args, { resolve: ["--scene", "--url", "--write", "--project", "--json"] }, fail, ["--write"]);
    if ("failed" in parsed) return parsed.failed;
    const { flags } = parsed;
    const text = (flag: string) => flags.get(flag) as string | undefined;
    const scene = text("--scene");
    if (!scene) return fail("depth resolve requires --scene.", "ERR_MISSING_VALUE", command);
    const result = await executeDepthResolve({ scene, url: text("--url") ?? `http://127.0.0.1:${environment.port ?? "5173"}`, write: flags.has("--write") },
      { root: text("--project") ?? environment.root });
    if (!result.success) {
      const issues = result.issues.map(normalizeIssue);
      return { code: 1, stdout: "", stderr: (wantsJson ? JSON.stringify({ ...result, issues, next: nextForIssues(issues) }) : issues.map(humanIssue).join("\n")) + "\n" };
    }
    const diff = (result.data as Record<string, unknown>).diff;
    return { code: 0, stdout: (wantsJson ? JSON.stringify(result) : `${flags.has("--write") ? "Froze" : "Would freeze"} ${scene} depth layers.\n${typeof diff === "string" ? diff : ""}`) + "\n", stderr: "" };
  }
  if (command !== "snapshot" && command !== "export" && command !== "scenes" && command !== "doctor" && command !== "render" && command !== "audio" && command !== "captions" && command !== "transitions" && command !== "prompts" && command !== "deliver" && command !== "create" && command !== "studio" && command !== "edit" && command !== "templates" && command !== "new" && command !== "brand" && command !== "compose" && command !== "review" && command !== "frames" && command !== "shot" && command !== "check" && command !== "skills" && command !== "inspect" && command !== "assets" && !Object.hasOwn(aliases, command)) return fail(`Unknown command: ${command}`, "ERR_UNKNOWN_COMMAND");
  if (command === "transitions") return runTransitionsCommand(args, fail);
  if (command === "prompts") return runPromptsCommand(args, fail);
  if (command === "studio") return runStudioCommand(args, environment, studioManager ?? executeStudioCommand, fail);
  if (command === "edit") return runEditCommand(args, environment, editManager ?? executeEditCommand, fail);
  if (command === "create") return runCreateCommand(args, environment, creator ?? executeCreateCommand, fail);
  if (command === "compose" && args[0] !== "snap") return runCompositionEdit(args, environment, fail);
  if (command === "compose" || command === "review" || (command === "audio" && args[0] === "beats")) return runEditorialCommand(command, args, environment, editorialManager ?? executeEditorialCommand, fail);
  if (command === "brand") return runBrandCommand(args, environment, brandManager ?? executeBrandCommand, fail);
  if (command === "templates") return runTemplatesCommand(args, environment, templateManager ?? executeTemplateCommand, fail);
  if (command === "new") return runNewCommand(args, environment, templateManager ?? executeTemplateCommand, fail);
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
    export: ["--project", "--url", "--output", "--fps", "--width", "--height", "--audio", "--captions", "--quality", "--stage-dpr", "--codec", "--transparent", "--motion-blur", "--motion-samples", "--gif-fps", "--poster", "--json"],
    doctor: ["--project", "--url", "--json"],
    render: ["--composition", "--frame", "--time", "--out", "--url", "--no-cache", "--cache-dir", "--parallel", "--fps", "--width", "--height", "--no-stream", "--quality", "--stage-dpr", "--codec", "--transparent", "--motion-blur", "--motion-samples", "--gif-fps", "--poster", "--preset", "--aspects", "--project", "--json"],
    frames: ["--composition", "--out", "--every", "--at", "--contact-sheet", "--columns", "--url", "--no-cache", "--cache-dir", "--project", "--json"],
    deliver: ["--composition", "--targets", "--out", "--quality", "--stage-dpr", "--parallel", "--no-cache", "--no-stream", "--url", "--project", "--json"],
    shot: ["--scene", "--time", "--out", "--url", "--quality", "--stage-dpr", "--motion-blur", "--motion-samples", "--fps", "--transparent", "--finish", "--project", "--json"],
    check: ["--frames", "--video", "--manifest", "--budget-ms", "--project", "--json"],
  };
  const allowed: string[] = flagSets[command] ?? ["--project", "--package", "--url", "--no-open", "--json", "--scene", "--adapter", "--composition"];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!allowed.includes(flag)) return fail(`Unknown option: ${flag}`, "ERR_UNKNOWN_OPTION", command);
    if (flags.has(flag)) return fail(`Duplicate option: ${flag}`, "ERR_DUPLICATE_OPTION", command);
    if (["--no-open", "--json", "--no-cache", "--no-stream", "--contact-sheet", "--transparent", "--finish"].includes(flag)) flags.set(flag, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) return fail(`Missing value for ${flag}`, "ERR_MISSING_VALUE", command);
      flags.set(flag, value);
    }
  }
  if (flags.has("--adapter") && command !== "init") return fail("--adapter is only valid for init.", "ERR_INVALID_FLAG_COMBINATION", command);
  if (flags.has("--stage-dpr") && !StageDprSchema.safeParse(Number(flags.get("--stage-dpr"))).success)
    return fail("--stage-dpr must be 1, 1.25, 1.5, 1.75, 2 or 3.", "ERR_UNKNOWN_OPTION", command);
  if (flags.has("--package") && command !== "init") return fail("--package is only valid for init.", "ERR_INVALID_FLAG_COMBINATION", command);
  if (flags.has("--composition") && !["validate", "render", "frames", "deliver"].includes(command)) return fail("--composition is only valid for validate, render, frames or deliver.", "ERR_INVALID_FLAG_COMBINATION", command);
  if (flags.has("--scene") && !["load", "open", "snapshot", "shot"].includes(command)) return fail("--scene is only valid for load, open, shot or snapshot.", "ERR_INVALID_FLAG_COMBINATION", command);
  if (["load", "validate", "scenes", "sync", "doctor"].includes(command) && flags.has("--no-open")) return fail("Preview options require init or open.", "ERR_INVALID_FLAG_COMBINATION", command);
  if (["load", "validate", "scenes", "sync"].includes(command) && flags.has("--url")) return fail("Preview options require init or open.", "ERR_INVALID_FLAG_COMBINATION", command);
  if (command === "init" && flags.has("--no-open") && !flags.has("--url")) return fail("init --no-open requires --url. To initialize without opening a browser, run npx velora init.", "ERR_INVALID_FLAG_COMBINATION", command);
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
      for (const extra of ["--parallel", "--fps", "--width", "--height", "--no-stream", "--quality", "--codec", "--transparent", "--motion-blur", "--motion-samples", "--gif-fps", "--poster", "--preset", "--aspects"]) {
        if (flags.has(extra)) return fail(`${extra} is only valid for video mode (a video --out without --frame/--time).`, "ERR_INVALID_FLAG_COMBINATION", command);
      }
      try {
        const result = await renderer({
          composition: flags.get("--composition") as string,
          ...(flags.has("--frame") ? { frame: Number(flags.get("--frame")) } : { timeMs: Number(flags.get("--time")) }),
          out,
          ...stageDprInput(flags),
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
    if (!/\.(mp4|webm|mov|gif)$/i.test(out)) return fail("Video mode needs a .mp4, .webm, .mov or .gif --out; add --frame/--time for stills.", "invalid-input", command);
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
        ...finishingInput(flags),
        ...(flags.has("--preset") ? { preset: flags.get("--preset") as string } : {}),
        ...(flags.has("--aspects") ? { aspects: String(flags.get("--aspects")).split(",").map(value => value.trim()) as ("16:9")[] } : {}),
      }, {
        root: context.root,
        url: serverUrl(flags, environment),
        ...cliVersion(environment),
        ...(progress.onProgress ? { onProgress: progress.onProgress } : {}),
      });
      if (!result.success) return operationalFailure(command, result.issues, json);
      const human = `Rendered ${result.data.out} (${result.data.frames} frames at ${result.data.fps} FPS, ${result.data.width}x${result.data.height}, ${result.data.codec ?? "h264"} ${result.data.quality ?? "standard"}, seed ${result.data.seed}, ${result.data.cachedFrames} cached).`
        + (result.data.variants?.length ? `\nVariants: ${result.data.variants.map(variant => variant.out).join(", ")}` : "")
        + (result.data.poster ? `\nPoster: ${result.data.poster}` : "")
        + (result.data.warnings?.length ? "\n" + result.data.warnings.map(warning => `Warning: ${warning.message}`).join("\n") : "");
      return { code: 0, stdout: progress.flush(json ? JSON.stringify(withCommand(result, command)) : human), stderr: "" };
    } catch {
      return operationalFailure(command, [{ code: "ERR_INTERNAL", message: "Video render failed unexpectedly. Check the composition, scene server and retry." }], json);
    }
  }
  if (command === "deliver") {
    const deliver = deliverer ?? executeDeliver;
    if (!flags.has("--composition")) return fail("deliver requires --composition.", "ERR_MISSING_VALUE", command);
    if (!flags.has("--targets")) return fail(`deliver requires --targets (comma-separated: ${ALL_DELIVER_TARGETS.join(", ")}).`, "ERR_MISSING_VALUE", command);
    if (flags.has("--quality") && !["draft", "standard", "master"].includes(flags.get("--quality") as string)) return fail("--quality must be draft, standard or master.", "ERR_UNKNOWN_OPTION", command);
    const progress = progressCollector(json, flags.has("--no-stream"));
    try {
      const result = await deliver({
        composition: flags.get("--composition") as string,
        targets: String(flags.get("--targets")).split(",").map((value) => value.trim()).filter(Boolean),
        ...stageDprInput(flags),
        ...(flags.has("--out") ? { out: flags.get("--out") as string } : {}),
        ...(flags.has("--quality") ? { quality: flags.get("--quality") as "draft" } : {}),
        ...(flags.has("--parallel") ? { parallel: Number(flags.get("--parallel")) } : {}),
        ...(flags.has("--no-cache") ? { noCache: true as const } : {}),
      }, {
        root: context.root,
        url: serverUrl(flags, environment),
        ...cliVersion(environment),
        ...(progress.onProgress ? { onProgress: progress.onProgress } : {}),
      });
      if (!result.success) return operationalFailure(command, result.issues, json);
      const human = `Delivered ${result.data.targets.length} target(s) to ${result.data.out} (manifest ${result.data.manifest}):\n`
        + result.data.targets.map((target) => `  ${target.name} (${target.preset}): ${target.files.join(", ")}`
          + target.warnings.map((warning) => `\n    Warning: ${warning.message}`).join("")).join("\n");
      return { code: 0, stdout: progress.flush(json ? JSON.stringify(withCommand(result, command)) : human), stderr: "" };
    } catch {
      return operationalFailure(command, [{ code: "ERR_INTERNAL", message: "Deliver failed unexpectedly. Check the composition, scene server and retry." }], json);
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
        ...(flags.has("--contact-sheet") ? { contactSheet: true as const } : {}),
        ...(flags.has("--columns") ? { columns: Number(flags.get("--columns")) } : {}),
        ...(flags.has("--cache-dir") ? { cacheDir: flags.get("--cache-dir") as string } : {}),
        ...(flags.has("--no-cache") ? { noCache: true as const } : {}),
      }, {
        root: context.root,
        url: serverUrl(flags, environment),
        ...cliVersion(environment),
        ...(progress.onProgress ? { onProgress: progress.onProgress } : {}),
      });
      if (!result.success) return operationalFailure(command, result.issues, json);
      const human = `Extracted ${result.data.total} frames to ${result.data.out}/ (manifest ${result.data.manifest}).${result.data.contactSheet ? `\nContact sheet: ${result.data.contactSheet}` : ""}`;
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
        ...stageDprInput(flags),
        ...(flags.has("--quality") ? { quality: flags.get("--quality") as "master" } : {}),
        ...(flags.has("--motion-blur") ? { motionBlur: Number(flags.get("--motion-blur")) } : {}),
        ...(flags.has("--motion-samples") ? { motionSamples: Number(flags.get("--motion-samples")) } : {}),
        ...(flags.has("--fps") ? { fps: Number(flags.get("--fps")) as 60 } : {}),
        ...(flags.has("--transparent") ? { transparent: true } : {}),
        ...(flags.has("--finish") ? { finish: true } : {}),
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
      ...(flags.has("--captions") ? { captions: flags.get("--captions") } : {}),
      ...finishingInput(flags) };
    try {
      const result = await exporter(input, context);
      if (!result.success) return operationalFailure(command, result.issues, json);
      const extras = result.data.audio || result.data.captions
        ? ` (${[result.data.audio ? `audio drift ${result.data.audio.driftMs}ms` : "", result.data.captions ? `${result.data.captions.cues} cues burned` : ""].filter(Boolean).join(", ")})`
        : "";
      return { code: 0, stdout: (json ? JSON.stringify(withCommand(result, command)) : `Exported ${result.data.output} (${result.data.frames} frames at ${result.data.fps} FPS, ${result.data.codec ?? "h264"} ${result.data.quality ?? "standard"})${extras}.${result.data.poster ? ` Poster: ${result.data.poster}.` : ""}`) + "\n", stderr: "" };
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
    return operationalFailure(command, [{code:"ERR_INTERNAL", message:"Project command failed unexpectedly. Your setup may be incomplete; run velora validate, correct the reported issue and retry."}], json);
  }
}
