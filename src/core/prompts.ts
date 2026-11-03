import { z } from "zod";

/** SOURCE OF TRUTH: PromptSchema, PROMPT_LIBRARY, findPrompt, fillPrompt.
 * WHAT: the copyable agent prompts for each launch intent (launch film, feature announcement, website
 * hero loop, vertical teaser, cinematic dashboard, changelog, Product Hunt assets, first scene): text with
 * <placeholders>, the templates or blueprints it starts from and the skills an agent loads for it.
 * WHY: one library feeds `velora prompts`, the generated VELORA.md and the studio's copy buttons, so a
 * person gets the same well-formed brief wherever they start.
 * WHERE: CLI `velora prompts ls|show`, project agentHandoff, preview GettingStarted and ParamPanel.
 * Templates and skills named here are checked against the catalogs by tests.
 */
export const PromptSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  intent: z.string().min(1),
  text: z.string().min(1),
  templates: z.array(z.string()),
  skills: z.array(z.string()).min(1).max(4),
  featured: z.boolean().default(false),
});
export type Prompt = z.output<typeof PromptSchema>;

const BASE = "Read VELORA.md and run npx velora guide --json in this project, then start from the installed velora/SKILL.md and follow its intent router.";
const PROOF = "Prove each shot with velora shot or velora frames --contact-sheet, read the PNGs, and fix what you see before rendering.";

export const PROMPT_LIBRARY: readonly Prompt[] = Object.freeze([
  {
    id: "launch-film", title: "Launch film (30 s)", featured: true,
    intent: "A 30-second announcement film for a product launch, cut to music.",
    text: `${BASE} Make a 30-second launch film for <product>, aimed at <audience>. The one message: <single message>. ` +
      "Start from the launch-film-30s blueprint (velora new video --blueprint launch-film-30s --id launch --route <route>) and follow brief.md: Hook, Problem, Reveal, Proof, CTA. " +
      "Replace each shot with this app's real components for <must-show features>, end on the call to action \"<cta>\", and keep a <calm|crisp|playful|bold> motion personality. " +
      `If there is music at <music file>, run velora audio beats --write-markers and velora compose snap --to beats. ${PROOF} ` +
      "Run velora review and velora check, render a draft (--quality draft), and wait for my review before the master render.",
    templates: ["launch-film-30s"], skills: ["velora-launch", "velora-templates", "velora-editing", "velora-render"],
  },
  {
    id: "feature-announcement", title: "Feature drop (15 s)", featured: true,
    intent: "A short video announcing one new feature.",
    text: `${BASE} Make a 15-second feature announcement for <feature name> in <product>. ` +
      "Start from the feature-drop-15s blueprint (velora new video --blueprint feature-drop-15s --id feature --component <path#Export>). " +
      "Open on the problem the feature solves, show the feature working in the real UI with one motivated camera move, and close on \"<cta>\". " +
      `${PROOF} Run velora review --platform <platform> and render a draft first.`,
    templates: ["feature-drop-15s", "cursor-demo", "hero-push"], skills: ["velora-launch", "velora-templates", "velora-editing"],
  },
  {
    id: "website-hero-loop", title: "Website hero loop", featured: true,
    intent: "A muted, seamless loop for the top of a landing page.",
    text: `${BASE} Make an 8-second seamless hero loop of <route> for our website. ` +
      "Start from the float-loop template (velora new scene --template float-loop --id hero --route <route>) or scroll-through for a long page. Keep the motion calm and the loop seam clean. " +
      "Render a WebM with velora render --preset website-hero, an H.264 MP4 fallback and a poster (--poster). Keep the WebM under the preset's size budget, " +
      "and give me the <video autoplay muted loop playsinline> embed with the poster and a reduced-motion fallback.",
    templates: ["float-loop", "scroll-through", "website-hero-loop-8s"], skills: ["velora-launch", "velora-templates", "velora-export"],
  },
  {
    id: "vertical-teaser", title: "Vertical teaser (9:16)", featured: true,
    intent: "A vertical social teaser with captions, cut on the beat.",
    text: `${BASE} Make a 9:16 social teaser for <platform> about <product>. ` +
      "Start from the social-teaser-9x16 blueprint (velora new video --blueprint social-teaser-9x16 --id teaser --route <route>). " +
      "Hook in the first second, keep shots short, and write karaoke captions for every line of the voiceover or on-screen story into the caption file. " +
      `Detect beats in <music file> and snap cuts with velora compose snap --to beats --write. Keep text inside the platform safe zones. ${PROOF} Run velora review --platform <platform>.`,
    templates: ["social-teaser-9x16"], skills: ["velora-launch", "velora-templates", "velora-editing", "velora-looks"],
  },
  {
    id: "dashboard-cinematic", title: "Make my dashboard cinematic", featured: true,
    intent: "One cinematic shot of an existing page or dashboard.",
    text: `${BASE} Make <route or component path> look cinematic in one shot. ` +
      "Pick a camera template that fits the subject (velora templates ls --json; hero-push, monumental-survey or rack-focus are good starts), scaffold it with the real component, " +
      "and refine one motivated move: choose the near edge, the detail to frame, the lens and where focus lands. " +
      `${PROOF} Show me the result in the studio at ?velora-preview=1.`,
    templates: ["hero-push", "monumental-survey", "rack-focus"], skills: ["velora-templates", "velora-cinematography"],
  },
  {
    id: "changelog-video", title: "Changelog video (20 s)", featured: false,
    intent: "A short release-notes video covering a few changes.",
    text: `${BASE} Make a 20-second changelog video for release <version> covering: <change 1>, <change 2>, <change 3>. ` +
      "Start from the changelog-20s blueprint (velora new video --blueprint changelog-20s --id changelog --route <route>). " +
      "Give each change a card and a real-UI shot, keep the reading time honest, and end on where to read more. " +
      `${PROOF} Run velora review and render a draft.`,
    templates: ["changelog-20s", "changelog-card"], skills: ["velora-launch", "velora-templates", "velora-editing"],
  },
  {
    id: "product-hunt-assets", title: "Product Hunt kit", featured: false,
    intent: "Gallery video, stills and a GIF for a Product Hunt launch.",
    text: `${BASE} Prepare Product Hunt launch assets for <product>: the gallery video, stills and a short GIF. ` +
      "Start from the product-hunt-kit blueprint (velora new video --blueprint product-hunt-kit --id ph --route <route>) and follow its brief.md. " +
      "Render the gallery video with velora render --preset product-hunt-gallery, posters with --poster, and the GIF with --preset github-readme-gif. " +
      "Report every file with its size against the preset's budget.",
    templates: ["product-hunt-kit"], skills: ["velora-launch", "velora-templates", "velora-export"],
  },
  {
    id: "first-scene", title: "First scene from my app", featured: false,
    intent: "A first bespoke scene built from the app's own components.",
    text: "Read VELORA.md and run npx velora guide --json. Inspect this app's existing components, styles and providers. Ask me which UI to feature, then create a Velora scene using the real components, " +
      "intentional perspective, focal depth and motion. Save the recipe and matching component in src/velora/scenes/ so they appear in the scene library. Keep the app's original design and data flow.",
    templates: [], skills: ["velora", "velora-scenes", "velora-cinematography"],
  },
].map(prompt => Object.freeze(PromptSchema.parse(prompt))));

export function findPrompt(id: string): Prompt | undefined {
  return PROMPT_LIBRARY.find(prompt => prompt.id === id);
}
/** Placeholders a prompt still contains, in order of appearance, without duplicates. */
export function promptPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/<([^<>]+)>/g)].map(match => match[1]).filter(name => !/^video\b/.test(name)))];
}
/** Replaces <placeholder> values a caller knows; unknown ones stay for the person to fill in. */
export function fillPrompt(prompt: Prompt, values: Readonly<Record<string, string>>): string {
  return prompt.text.replace(/<([^<>]+)>/g, (whole, name: string) => values[name] ?? whole);
}
/** The studio's per-template prompt: the scaffold command the param panel built, plus the proof loop. */
export function scaffoldPrompt(template: { id: string; title: string }, scaffold: string): string {
  return `Read VELORA.md and run npx velora guide. Create a Velora scene from the "${template.id}" template (${template.title}): run ${scaffold}. ` +
    "Use this app's real component (replace <path#Export>) or keep the route, wrap any providers the component needs where the binding's TODO(velora) comment says, " +
    "then prove it with velora shot at the start, middle and end. Refine the recipe JSON by hand; keep the single motivated move.";
}
