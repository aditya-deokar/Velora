import { AspectSchema, ASPECT_FRAMES, type Aspect, type ShotDefinition } from "./shots";
import { compositePreview, type CompositeDefinition } from "./composites";
import { RouteSchema, findTemplate, resolveTemplateParams, templateDefinition, templateDepth, templateSubject, type ParamValue, type TemplateIssue, type TemplateManifest } from "./templates";
import { DEFAULT_STAGE, stageFromSpec, type Stage } from "./stage";

/** SOURCE OF TRUTH: QUICK_SHOT_PARAMS, readQuickShot, quickShotQuery, quickShotCommands.
 * WHAT: the studio's quick-shot URL contract (velora-quick, velora-route, velora-params as base64url
 * JSON of template overrides plus aspect) and the exact CLI commands a quick shot copies.
 * WHY: one pure codec serves deep links, reloads, export (`velora export --url`) and copy actions, so
 * a quick shot exports with zero source files and every copied command matches what was previewed.
 * WHERE: preview QuickShot/ParamPanel read and write it; tests round-trip it. No DOM globals here:
 * callers pass any {get(name)} query (URLSearchParams) and merge quickShotQuery into their URL.
 */
export const QUICK_SHOT_PARAMS = Object.freeze({ template: "velora-quick", route: "velora-route", params: "velora-params" });
export type QuickShotState = { template: string; route?: string; aspect: Aspect; stage?: string; overrides: Record<string, string | number> };
export type QuickShot = QuickShotState & { manifest?: TemplateManifest; params: Record<string, ParamValue>; definition?: ShotDefinition & { stage: Stage }; composite?: CompositeDefinition; issues: TemplateIssue[] };

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return bytes;
}
function fromUtf8(bytes: number[]): string {
  let text = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    const extra = b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : 0;
    let code = extra ? b & (0x3f >> extra) : b;
    for (let k = 1; k <= extra; k++) code = (code << 6) | ((bytes[i + k] ?? 0) & 63);
    text += String.fromCodePoint(code);
    i += extra + 1;
  }
  return text;
}
export function encodeBase64Url(text: string): string {
  const bytes = utf8(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : "") + (i + 2 < bytes.length ? ALPHABET[n & 63] : "");
  }
  return out;
}
export function decodeBase64Url(text: string): string | undefined {
  const bytes: number[] = [];
  let bits = 0, value = 0;
  for (const char of text.replace(/=+$/, "")) {
    const index = ALPHABET.indexOf(char === "+" ? "-" : char === "/" ? "_" : char);
    if (index < 0) return undefined;
    value = (value << 6) | index; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 255); }
  }
  return fromUtf8(bytes);
}

export type QueryLookup = { get(name: string): string | null };
/** Parse quick-shot query params into a validated template definition (issues instead of throws). */
export function readQuickShot(query: QueryLookup): QuickShot | undefined {
  const template = query.get(QUICK_SHOT_PARAMS.template);
  if (!template) return undefined;
  const issues: TemplateIssue[] = [];
  const raw = query.get(QUICK_SHOT_PARAMS.route);
  const route = raw === null ? undefined : raw;
  if (route !== undefined && !RouteSchema.safeParse(route).success)
    issues.push({ code: "ERR_ROUTE_INVALID", path: QUICK_SHOT_PARAMS.route, message: "Use a same-origin route path such as / or /pricing." });
  let decoded: Record<string, unknown> = {};
  const packed = query.get(QUICK_SHOT_PARAMS.params);
  if (packed) {
    try {
      const value = JSON.parse(decodeBase64Url(packed) ?? "");
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      decoded = value as Record<string, unknown>;
    } catch { issues.push({ code: "ERR_TEMPLATE_PARAM", path: QUICK_SHOT_PARAMS.params, message: "velora-params must be base64url JSON of template params." }); }
  }
  const { aspect: rawAspect = "16:9", stage: rawStage = DEFAULT_STAGE, ...rest } = decoded;
  const aspectResult = AspectSchema.safeParse(rawAspect);
  const stage = typeof rawStage === "string" ? stageFromSpec(rawStage) : undefined;
  if (!stage) issues.push({ code: "ERR_TEMPLATE_PARAM", path: "params.stage", message: "Choose a stage preset or enter WxH@DPR, such as 1512x982@2." });
  const overrides: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(rest))
    if (typeof value === "string" || typeof value === "number") overrides[key] = value;
    else issues.push({ code: "ERR_TEMPLATE_PARAM", path: `params.${key}`, message: `${key} must be a string or number.` });
  const manifest = findTemplate(template);
  const state: QuickShotState = { template, ...(route !== undefined ? { route } : {}), aspect: aspectResult.success ? aspectResult.data : "16:9",
    ...(typeof rawStage === "string" && rawStage !== DEFAULT_STAGE ? { stage: rawStage } : {}), overrides };
  if (!manifest) return { ...state, params: {}, issues: [...issues, { code: "ERR_TEMPLATE_NOT_FOUND", path: QUICK_SHOT_PARAMS.template, message: `No template "${template}".` }] };
  if (!aspectResult.success || !manifest.aspects.includes(state.aspect))
    issues.push({ code: "ERR_TEMPLATE_ASPECT", path: "params.aspect", message: `${manifest.id} supports ${manifest.aspects.join(", ")}.` });
  const resolved = resolveTemplateParams(manifest, overrides);
  issues.push(...resolved.issues);
  const built = issues.length || !stage ? undefined : templateDefinition(manifest, resolved.params, state.aspect, templateSubject(state.aspect, stage));
  const depth = templateDepth(manifest);
  // Layered and motion-graphics templates also carry their layout; the definition stays recipe-shaped.
  return { ...state, manifest, params: resolved.params, ...(built && stage ? { definition: { ...compositePreview(built), stage, ...(depth ? { depth } : {}) } } : {}),
    ...(built && "layout" in built ? { composite: built as CompositeDefinition } : {}), issues };
}

/** The quick-shot query params for a state (absent keys must be removed from the URL). */
export function quickShotQuery(state: QuickShotState): Record<string, string> {
  const packed = { ...state.overrides, ...(state.aspect !== "16:9" ? { aspect: state.aspect } : {}), ...(state.stage && state.stage !== DEFAULT_STAGE ? { stage: state.stage } : {}) };
  return {
    [QUICK_SHOT_PARAMS.template]: state.template,
    ...(state.route !== undefined ? { [QUICK_SHOT_PARAMS.route]: state.route } : {}),
    ...(Object.keys(packed).length ? { [QUICK_SHOT_PARAMS.params]: encodeBase64Url(JSON.stringify(packed)) } : {}),
  };
}

const quote = (value: string) => /^[\w@%+=:,./#-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'";
/** Exact commands for a quick shot: scaffold it into source, or export it straight from the URL. */
export function quickShotCommands(state: QuickShotState, href: string, options: { id?: string; fps?: number } = {}) {
  const id = options.id ?? `${state.template}-shot`;
  const frame = ASPECT_FRAMES[state.aspect];
  const sets = Object.entries(state.overrides).map(([key, value]) => ` --set ${quote(`${key}=${value}`)}`).join("");
  const scaffold = `npx velora new scene --template ${state.template} --id ${id}` +
    (state.route !== undefined ? ` --route ${quote(state.route)}` : " --component <path#Export>") +
    (state.aspect !== "16:9" ? ` --aspect ${state.aspect}` : "") + sets + ` --stage ${quote(state.stage || DEFAULT_STAGE)} --json`;
  const exported = `npx velora export --url ${quote(href)} --output ${id}.mp4 --width ${frame.width} --height ${frame.height} --fps ${options.fps ?? 30}`;
  return { scaffold, export: exported };
}
