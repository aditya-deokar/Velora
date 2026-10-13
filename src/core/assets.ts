import { z } from "zod";

/** SOURCE OF TRUTH: AssetSchema, AssetManifestSchema, asset discovery policy.
 * WHAT: versioned asset contracts, file-based discovery rules and pure type sniffing.
 * WHY: agents reference images, video, audio and fonts by stable IDs without executing project code.
 * WHERE: project/discovery scans the assets directory; project/commands resolves IDs for compositions and validation.
 * Core stays pure: byte sniffing works on supplied buffers; services owns all filesystem reads.
 */
export const ASSETS_DIRECTORY = "assets";
export const ASSET_MANIFEST = "assets/assets.json";
export const MAX_ASSET_BYTES = 52_428_800;
export const MAX_ASSETS = 1024;
export const AssetIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase asset slug containing letters, digits and single hyphens.");
export type AssetId = z.output<typeof AssetIdSchema>;
export const AssetTypeSchema = z.enum(["image", "video", "audio", "font"]);
export type AssetType = z.output<typeof AssetTypeSchema>;
export const AssetSchema = z.strictObject({
  id: AssetIdSchema,
  path: z.string().min(1),
  type: AssetTypeSchema,
});
export type AssetDeclaration = z.output<typeof AssetSchema>;
// A discovered file: the sniffed type plus "other" for unrecognized content,
// which `assets check` and validation report instead of silently accepting.
export const DiscoveredAssetSchema = z.strictObject({
  id: z.string().min(1),
  path: z.string().min(1),
  type: z.union([AssetTypeSchema, z.literal("other")]),
  bytes: z.number().int().nonnegative(),
});
export type DiscoveredAsset = z.output<typeof DiscoveredAssetSchema>;
export const AssetManifestSchema = z.strictObject({
  version: z.literal(1),
  assets: z.record(AssetIdSchema, z.string().min(1)),
});
export type AssetManifest = z.output<typeof AssetManifestSchema>;

const extensionKinds: Record<string, AssetType> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", avif: "image", bmp: "image",
  mp4: "video", webm: "video", mov: "video", mkv: "video",
  mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", flac: "audio", aac: "audio",
  ttf: "font", otf: "font", woff: "font", woff2: "font",
};
export function assetExtension(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}
export function assetIdFromFilename(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? base : base.slice(0, dot);
}
function ascii(head: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end && i < head.length; i++) out += String.fromCharCode(head[i]);
  return out;
}
function magicKind(head: Uint8Array): AssetType | undefined {
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image";
  if (head.length >= 6 && (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a")) return "image";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "image";
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") return "video";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE") return "audio";
  if (head.length >= 3 && ascii(head, 0, 3) === "ID3") return "audio";
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "audio";
  if (head.length >= 4 && ascii(head, 0, 4) === "OggS") return "audio";
  if (head.length >= 4 && (ascii(head, 0, 4) === "wOFF" || ascii(head, 0, 4) === "wOF2")) return "font";
  if (head.length >= 4) {
    const tag = ascii(head, 0, 4);
    if (tag === "OTTO" || tag === "true" || tag === "typ1") return "font";
    if (head.length >= 4 && head[0] === 0x00 && head[1] === 0x01 && head[2] === 0x00 && head[3] === 0x00) return "font";
  }
  return undefined;
}
// Deterministic sniffing: a recognized extension wins unless magic bytes prove
// a different kind; recognized magic wins when the extension is unknown;
// SVG is text, so it is recognized by markup instead of binary magic.
export function sniffAssetType(filename: string, head: Uint8Array): AssetType | "other" {
  const extension = assetExtension(filename);
  const fromExtension = extension ? extensionKinds[extension] : undefined;
  if (extension === "svg") {
    return ascii(head, 0, Math.min(head.length, 2048)).includes("<svg") ? "image" : "other";
  }
  const fromMagic = magicKind(head);
  if (fromMagic && fromExtension && fromMagic !== fromExtension) return "other";
  return fromMagic ?? fromExtension ?? "other";
}
// Validate a parsed assets.json document without touching the filesystem.
export function validateAssetManifest(document: unknown): { aliases: Record<string, string>; issues: { code: string; path: string; message: string }[] } {
  const parsed = AssetManifestSchema.safeParse(document);
  if (!parsed.success) return {
    aliases: {},
    issues: parsed.error.issues.map((issue) => ({
      code: "invalid-file",
      path: `assets.json${issue.path.length ? "." + issue.path.join(".") : ""}`,
      message: issue.message,
    })),
  };
  const issues: { code: string; path: string; message: string }[] = [];
  for (const [id, target] of Object.entries(parsed.data.assets)) {
    if (target.includes("\\") || target.includes("\0") || target.split("/").some((part) => part === "" || part === "." || part === ".."))
      issues.push({ code: "denied-path", path: `assets.json.assets.${id}`, message: "Use a project-relative path inside assets/ without traversal." });
    else if (!target.startsWith(`${ASSETS_DIRECTORY}/`))
      issues.push({ code: "denied-path", path: `assets.json.assets.${id}`, message: `Manifest entries must live inside ${ASSETS_DIRECTORY}/.` });
  }
  return { aliases: parsed.data.assets, issues };
}
// Resolve an asset ID to its project-relative path: an explicit manifest
// alias wins, otherwise the single file whose stem matches the ID.
export function resolveAssetId(assets: readonly DiscoveredAsset[], aliases: Readonly<Record<string, string>>, id: string): string | undefined {
  if (aliases[id]) return aliases[id];
  return assets.find((asset) => asset.id === id)?.path;
}
