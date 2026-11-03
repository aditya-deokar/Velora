import { useEffect, useMemo, useState } from "react";
import { parseCaptions, type PreviewDefinitionInput } from "../core";
import { Surface } from "../react";
import { BrandProvider, CaptionTrack, type CaptionCueInput, type CaptionStyle, type CaptionWord } from "../kit";
import { ScenePreview } from "./ScenePreview";
import { useProjectBrand } from "./TemplateLayout";

/** SOURCE OF TRUTH: CaptionsScene, readCaptionsRequest.
 * WHAT: a full-frame captions layer opened by URL (velora-captions, velora-caption-style, velora-caption-size,
 * velora-caption-duration, velora-caption-words): the composition's caption file drawn through kit
 * CaptionTrack, safe-zone placed, on a transparent stage with a capture bridge.
 * WHY: styled captions (karaoke, bold-pop, lower, minimal) render as a real DOM overlay that the
 * compositor alpha-blends over the picture, so captions match the studio and need no scene files.
 * WHERE: ProjectPreview opens it; export services capture it transparently as the top overlay layer.
 */
export type CaptionsRequest = { file: string; style: CaptionStyle; width: number; height: number; durationMs: number; wordsFile?: string };
export function readCaptionsRequest(search: string): CaptionsRequest | undefined {
  const query = new URLSearchParams(search);
  const file = query.get("velora-captions");
  if (!file) return undefined;
  const [width, height] = (query.get("velora-caption-size") ?? "1920x1080").split("x").map(Number);
  const style = query.get("velora-caption-style");
  return { file, style: (["minimal", "karaoke", "bold-pop", "lower"].includes(style ?? "") ? style : "minimal") as CaptionStyle,
    width: width || 1920, height: height || 1080, durationMs: Math.max(1, Number(query.get("velora-caption-duration")) || 1000),
    ...(query.get("velora-caption-words") ? { wordsFile: query.get("velora-caption-words")! } : {}) };
}
type WordsDocument = { words?: { text: string; startMs: number; endMs: number }[] };
export function CaptionsScene({ request }: { request: CaptionsRequest }) {
  const brand = useProjectBrand();
  const [cues, setCues] = useState<CaptionCueInput[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      const text = await fetch(new URL("/" + request.file.replace(/^\.?\//, ""), location.origin)).then(response => { if (!response.ok) throw new Error(`Caption file ${request.file} is not served by the dev server.`); return response.text(); });
      const parsed = parseCaptions(text, request.file.toLowerCase().endsWith(".vtt") ? "vtt" : "srt");
      if ("issues" in parsed) throw new Error(parsed.issues[0].message);
      let words: CaptionWord[] = [];
      if (request.wordsFile) {
        const document = await fetch(new URL("/" + request.wordsFile.replace(/^\.?\//, ""), location.origin)).then(response => response.json() as Promise<WordsDocument>);
        words = document.words ?? [];
      }
      // Words belong to the cue whose span holds their start.
      const assembled = parsed.cues.map(cue => ({ ...cue, words: words.filter(word => word.startMs >= cue.startMs && word.startMs < cue.endMs) }));
      if (active) setCues(assembled);
    };
    load().catch(failure => { if (active) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { active = false; };
  }, [request.file, request.wordsFile]);
  const portrait = request.height > request.width;
  // Clear of approximate platform UI: the bottom fifth (caption block, buttons) on vertical video.
  const bottom = portrait ? request.height * 0.26 : request.height * (request.style === "lower" ? 0.1 : 0.08);
  const size = Math.round((portrait ? request.width : request.height) * (request.style === "bold-pop" ? 0.052 : 0.04));
  const definition = useMemo<PreviewDefinitionInput | undefined>(() => cues && {
    width: request.width, height: request.height, scene: { nodes: [{ id: "captions" }] }, motion: { durationMs: request.durationMs, speed: 1, tracks: [] },
  }, [cues, request.width, request.height, request.durationMs]);
  if (error) return <div role="alert" style={{ padding: 40, color: "#fff", background: "#000" }}>Captions could not load: {error}</div>;
  return <ScenePreview title="Captions" definition={definition}>
    <BrandProvider brand={brand}>
      <Surface id="captions" style={{ position: "absolute", left: 0, top: 0, width: request.width, height: request.height }}>
        {/* Surface content sits in a zero-height leaf: position against a full-frame box, not the leaf. */}
        <div style={{ position: "relative", width: request.width, height: request.height }}>
          <div style={{ position: "absolute", left: request.width * 0.08, right: request.width * (portrait ? 0.18 : 0.08), bottom, display: "flex", justifyContent: request.style === "lower" ? "flex-start" : "center" }}>
            {cues && <CaptionTrack cues={cues} variant={request.style} size={size}/>}
          </div>
        </div>
      </Surface>
    </BrandProvider>
  </ScenePreview>;
}
