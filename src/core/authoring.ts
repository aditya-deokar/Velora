import { z } from "zod";
import { VELORA_BRAND, VELORA_PACKAGE } from "./branding";
import { CLI_COMMANDS, CommandIndexSchema } from "./cli-schema";
import { SceneRecipeSchema, SCENE_RECIPE_DIRECTORY } from "./recipes";
import { CameraSchema, FocusSchema, SceneSchema, TransformSchema, SCENE_BACKGROUND } from "./scene";
import { MotionSchema, MotionTrackSchema, MotionKeyframeSchema, SURFACE_VISUAL_PROPERTIES, loopSeam, motionDuration, motionTracks, pathSpeeds } from "./motion";
import { EASING_NAMES, easingOvershoots } from "./easing";
import { perspectiveForFocalLength } from "./lens";
import { CascadeSchema } from "./choreography";
import { SUPPORTED_EXPORT_FPS, CaptureManifestSchema, QUALITY_PRESETS, CODEC_CONTAINERS, ALPHA_CODECS, resolveFinishing } from "./export";
import { DEFAULT_STAGE, StageSchema, STAGE_PRESETS, STAGE_DPRS, sceneStageBudget } from "./stage";
import { DELIVERY_PRESETS } from "./delivery";
import { PROMPT_LIBRARY } from "./prompts";

/** SOURCE OF TRUTH: getAuthoringGuide, reviewAuthoring, AuthoringGuideSchema.
 * WHAT: versioned cinematic concepts, actual capabilities and non-prescriptive review.
 * WHY: agents and other clients share a language, not a fixed shot or copied prompt.
 * WHERE: RESOURCES binds these pure operations; CLI guide and package consumers use them.
 * Schemas own technical limits; advice never rejects an intentional artistic choice.
 */
const ConceptSchema = z.strictObject({
  id:z.string(), title:z.string(), meaning:z.string(), mechanism:z.string(),
  choices:z.string(), pitfalls:z.string(), verify:z.string(),
});
export const AuthoringGuideSchema = z.strictObject({
  version:z.literal(4), purpose:z.string(), creativeFreedom:z.string(), stageBackdrop:z.literal(SCENE_BACKGROUND),
  concepts:z.array(ConceptSchema), workflow:z.array(z.string()),
  capabilities:z.record(z.string(),z.unknown()),
  cliVersion:z.string().min(1).optional(),
  commands:z.array(CommandIndexSchema).optional(),
});
export type AuthoringGuide = z.infer<typeof AuthoringGuideSchema>;
const concepts: z.infer<typeof ConceptSchema>[] = [
 {id:"spatial",title:"Real UI becomes spatial material",
 meaning:"A cinematic UI scene reveals a recognizable product through depth, changing viewpoint and directed attention in black void space. Tight oblique detail, a receding app plane and layered fragments should read as views of the same real application, not unrelated objects floating in a presentation. It is not inherently a slideshow, a device screenshot, a new dashboard design or a collection of decorative rotations.",
 mechanism:"Scene establishes a black void viewport and camera. Its SCENE_BACKGROUND contract owns the black backdrop; retain that same color around the capture frame. This never recolors the actual UI on a Surface. Surface places an existing React subtree in that space; nested surfaces inherit parent transforms. Motion is a positioning alias for Surface. Layout stays in CSS, spatial transforms belong to Velora. Surface morphing here means changing position, orientation, scale and composition, not bending a mesh or deforming pixels.",
 choices:"Choose an identifiable subject and its relationship to the app. A close crop can isolate one important detail while framing, adjacent context or the unfolding reveal explains its place. Scattered unrelated elements without a product relationship miss the intended outcome. Choose meaningful content from the requested page: a whole page, a panel, a few related elements, or a progression between detail and context. The user's intent determines what deserves attention. Depth, camera path, rhythm and focus may differ radically between scenes; no sidebar layout or reference shot is required.",
 pitfalls:"Do not recreate the host UI to make it easier to animate, replace its theme, copy its fetch logic, or assume that installation invents a shot. Keep original providers and components. Use a dedicated branch when useful without changing the user's branch automatically.",
 verify:"Compare the ordinary page and the scene for styling, content, interactions and component identity. There should be one rendered instance of each chosen live component, not sharp/blurred clones."},
 {id:"camera",title:"Viewpoint creates the reveal",
 meaning:"Compose the camera first. The default outcome is a dramatic close oblique view of a large app surface in a black void: one side or corner is visibly near and the opposite side recedes. The camera travels across that surface. A small centered panel moving around the frame does not establish this visual language. Dramatic perspective can come from a fixed viewing angle and close distance; it does not require animated rotation.",
 mechanism:"Coordinates use pixels and degrees: +x right, +y down, +z toward the viewer. Camera xyz subtracts from scene positions; camera rotation uses stage-rotation convention, not an inverse physical camera pose. In an untilted scene, increasing camera z makes a surface recede, decreasing it brings it closer. Rotation complicates apparent axes: use matrixFor/multiply for local-axis paths instead of copying transform math. CSS perspective sets projection strength (field of view). lensFor/perspectiveForFocalLength map full-frame lens millimetres to perspective (frameHeight x mm / 24) and the matching focus focalLength, so a 35 mm, 50 mm or 85 mm feel is one number. Perspective is an animatable camera track: animating it against camera z keeps a subject's size while the background stretches (a dolly zoom).",
 choices:"First choose the near edge or corner, the detail to frame, viewing distance and a travel axis along the page. Any side or corner can lead: bottom looking upward, top looking downward, left-near/right-far or the reverse. Keep the page pose stable for a camera survey and animate camera translation along one surface-aligned direction. Several xyz tracks can express one diagonal rail; they must share timing/easing. Keep viewing angle steady unless an intentional reveal needs rotation. Surface motion belongs to assembly, floating or deliberate object choreography, not a substitute for camera travel. Creator overrides remain valid.",
 pitfalls:"An arbitrary 360-degree spin usually hides the product. Avoid large, competing rotations or oscillation without a reason. Positive z is not unlimited: crossing the CSS projection plane causes clipping or explosive perspective. An entrance that feels behind the viewer should begin offscreen or faded near the view and settle into visible space, not pass through the projection singularity. Keep depth ranges modest relative to perspective and inspect the full path.",
 verify:"Scrub beginning, middle, end and intermediate frames. Confirm the target remains readable, projected surfaces do not disappear or invert, and camera movement advances the narrative instead of merely adding motion."},
 {id:"focus",title:"Depth of field belongs to the camera",
 meaning:"A camera focuses a plane at a distance along its viewing axis. Different objects at the same depth can be sharp together; screen position does not decide sharpness. Moving or turning the camera changes the depth of each visible point, so the in-focus region moves over the real UI naturally.",
 mechanism:"Scene version 3 owns focus {distance, fStop, focalLength, maxBlur}. Distance and focalLength use the same scene units; distance must exceed focalLength. Camera projection is at +perspective, so a camera-space point z has depth perspective-z. Animate focus.distance to rack focus; raise fStop for deeper, gentler focus and lower it for shallow focus. Start with defaults (fStop 8, focalLength 50, maxBlur 6), then set distance for the intended subject. No circle, radius, falloff, target ID or manual filter is needed. The canonical thin-lens calculation produces a local blur kernel before CSS projection, avoiding double magnification.",
 choices:"Keep focus distance fixed for a camera survey, or animate it independently for a focus pull. Judge foreground and background together at actual output size. Prefer gentle softness over destroying readability; change aperture before increasing the blur cap. Screen-separated objects at the focal plane correctly remain sharp.",
 pitfalls:"Version 2 radial focus fields are rejected instead of being silently reinterpreted. Native DOM rendering approximates aperture blur with Gaussian basis kernels; it does not reproduce Blender's aperture-shaped bokeh, ray-traced occlusion or lens artifacts. Every visible text/media region must belong to a visual Surface leaf or content. A spatial group cannot blur its descendants without flattening them; uncovered content produces diagnostics and capture refuses an invalid scene.",
 verify:"Check equal-depth subjects on opposite screen sides, a nearer and farther subject, and a tilted plane. Camera rotation/translation and focus-distance changes must change actual sharpness. Inspect background/sidebar/header coverage, styles and state. Pass browser pixel and performance checks; metadata does not certify optical or artistic fidelity."},
 {id:"parallax",title:"Depth makes layers relate",
 meaning:"Parallax is the different apparent movement of near and far content when the viewpoint changes. A grouping of elements feels spatial when their depth and motion reveal a relationship, not just when every item has the same offset.",
 mechanism:"Extract meaningful existing subtrees into stable Surface wrappers. Different z positions under perspective create differential scale and motion. Parent surfaces carry child layers; local coordinates belong to their parent. createCascadeTracks provides ordered varying depth with overlapping eased settling. It is one optional composition mechanism, not the definition of a cinematic scene.",
 choices:"Depth may reveal hierarchy, assembly, separation, comparison or a passage from detail to context. A linked cascade can feel like a string of elements settling; another shot can use simultaneous motion, quiet depth layers, or independent emphasis. Choose decomposition according to the content and user request. A group can approach from offscreen, recede or settle without all shots repeating a staircase.",
 pitfalls:"More layers is not always better. Avoid arbitrary splitting of every character or huge numbers of filtered surfaces. Do not detach labels from meaning. A flat synchronized stack creates little depth contrast; excessive separation breaks the perceived relationship to the original UI.",
 verify:"Compare relative positions at multiple times. Verify near/far layers actually change their projected relationship, then resolve into a coherent arrangement rather than permanently overlapping unreadable content."},
 {id:"surface-travel",title:"Technique: travel along a monumental surface",
 meaning:"Close camera placement and foreshortening make an ordinary page feel like a massive screen extending into the void. This is a composition family, not a fixed layout or numeric preset.",
 mechanism:"Keep the page transform fixed. Establish the near edge with camera orientation and distance, then translate the camera along the projected page tangent. This renderer composes camera translation before stage rotation: derive the tangent using the canonical matrixFor/multiply rotation matrices, including ancestor surface orientation, rather than assuming camera y follows a tilted page. Use a direction, with no translation component. A single rail may require correlated x/y/z tracks with matching endpoints and easing; never copy spatial math.",
 choices:"Choose any edge or corner and either direction of travel. Crop beyond the capture frame when that conveys scale; preserve a recognizable detail and a receding edge. Hold the angle and distance relationship through the survey. A slow dolly toward or away from the plane is a separate intentional move.",
 pitfalls:"Do not automatically fit the whole page, level the tilt at the end, pan unrelated screen axes, or animate page position to fake the requested camera track. Avoid crossing the projection plane.",
 verify:"Approve a still frame before animation: visible near/far size difference, dramatic crop, black void and depth-driven sharp-to-soft transition. At several times verify the page pose is unchanged and the camera follows the intended edge without drifting away from the subject."},
 {id:"plating",title:"Technique: plating a page together",
 meaning:"Recognizable sections converge from separated depth into their original page positions while an oblique camera travels across them. Assembly is purposeful object motion paired with a camera shot.",
 mechanism:"Start from the final host layout and stable wrappers. Give related pieces distinct local depth/offsets, then settle them to their original slots using canonical motion/cascade tracks. Animate the camera on its own rail; an opposing direction can increase relative foreground/background travel. Keep original backing paint and live UI identity.",
 choices:"Choose a few meaningful sections and an order or overlapping linked cascade. Vary starting distance, direction and timing; a staircase is optional. Keep enough of the receiving page or neighboring pieces visible to explain where each piece belongs.",
 pitfalls:"A set of unrelated panels drifting forever is not plating. Do not flatten the camera angle to make assembly easier, redraw the page, or let excessive counter-motion make the result unreadable.",
 verify:"Inspect both the dramatic starting composition and final registration against the original page. Check visible relative depth during convergence, focal-plane crossing and no overlap errors in the assembled result."},
 {id:"microzoom",title:"Technique: an extreme detail shot",
 meaning:"The camera is close enough that a small real control, icon or label becomes the subject of the frame, while surrounding UI recedes diagonally out of view.",
 mechanism:"Use camera distance and translation to frame the existing detail on an oblique plane. Keep its host subtree intact. Set focus.distance to that detail's camera-axis depth and use aperture for gentle separation; travel a short distance along the plane.",
 choices:"Choose a meaningful detail from the requested page. An icon need not be centered; its neighboring text or surface edge can establish context. Change edge, corner and travel direction instead of copying one reference crop.",
 pitfalls:"Scaling an isolated icon against empty black is not the same camera shot. Do not zoom until the projection clips or blur the entire subject. Preserve original typography and paint.",
 verify:"At output size the chosen detail is identifiable, its nearby surface shows perspective recession, and adjacent content becomes progressively softer. Confirm the short camera rail retains the detail."},
 {id:"floating",title:"Technique: floating foreground with depth context",
 meaning:"A lifted control or section reads as floating because a related page or other surface remains visibly behind it. Black void is the stage; it is not a substitute for the background subject needed to demonstrate relative parallax.",
 mechanism:"Place the existing foreground subtree on a nearer Surface and retain a distinct related background Surface. Translate the camera so their projected positions change differently. Gentle foreground motion may supplement that move. Use canonical depth of field to distinguish depth without erasing all background structure.",
 choices:"Lift a sidebar, input, modal or meaningful section with its original backing paint. Leave some silhouette against the void and some overlap against the page when useful; choose separation according to the actual composition.",
 pitfalls:"One isolated object on black cannot demonstrate foreground/background relative motion. Two equal-depth layers or a completely obscured background also fail that evidence. Never duplicate the lifted UI in its old slot to manufacture depth.",
 verify:"In multiple frames both depth references remain visible, their relative positions change, and the lifted content still belongs visually to the app. Verify some background structure survives the blur."},
 {id:"motion",title:"Timing gives weight and continuity",
 meaning:"Gentle acceleration, measured travel and gentle settling make a reveal feel deliberate. The relationship between movements matters more than forcing one universal duration or trajectory.",
 mechanism:"MotionSchema owns half-speed playback and cinematic outgoing easing by default. Authored duration/keyframes use authored milliseconds; Scene timeMs is elapsed presentation milliseconds. motionDuration gives playback duration; useSceneTime gives the speed-adjusted authored time for charts. The cinematic curve has zero velocity and acceleration at endpoints, so multiple segments settle at each keyframe. Keyframe easing also accepts the sine/quad/cubic/quart/quint/expo/circ/back/elastic/bounce families (.in/.out/.inOut), {cubicBezier:[x1,y1,x2,y2]}, {spring:{stiffness,damping,mass}}, {steps} and hold. For a camera that keeps traveling through waypoints, set the track interpolation to 'smooth' (one continuous curve) with a track-level ease such as 'cinematic' so it accelerates and settles once. Track noise {amplitude,frequency,octaves,seed} adds seeded handheld texture to position/rotation tracks. Channel tracks ({kind:'channel',id}, property 'value') drive component state through useChannel(id) on the same clock. Surface opacity, blur and clip* properties style the visual leaf: blur composes with depth of field, clipTop/Right/Bottom/Left are inset wipes in percent and clipRadius is an iris. motion.loop wraps preview playback; keep the first and last values equal for a seamless loop.",
 choices:"Vary the sequence, depth relationship, direction, camera framing and focus behavior for different creative intentions. Overlap related entrances for continuity, allow moments of stillness for reading, and settle purposefully. Explicit speed, easing and cascade overrides belong to the creator. Native preview cadence follows the display; sampleFrameTime can simulate lower cadence without changing duration.",
 pitfalls:"Do not copy an easing evaluator or create independent clocks for camera, focus and surfaces. Linear movement or abrupt direction changes should be intentional, not an accidental omitted default. Longer timing alone does not fix an incoherent scene; excessive slowness can also lose attention.",
 verify:"Play at normal size and seek deterministically. Look for sudden velocity changes, needless pauses at camera waypoints and unrelated host animations running on another clock. Respect reduced motion by starting paused and offering seeking."},
 {id:"composition",title:"Preserve the live tree and its paint",
 meaning:"The host application is the visual source of truth. Spatial framing should reveal that design rather than silently redesign it.",
 mechanism:"Scene wraps stable Surface IDs. Ordinary leaf UI can be children; when a Surface groups other surfaces, put its background/decorations in content and its spatial children in children. Content is the filtered visual leaf; spatial groups retain preserve-3d. No manual filter stacking is needed. Group opacity does not fade all descendants: animate the actual visual leaves. Keep providers outside or in the original tree and keep wrapper identity stable during playback. Stable DOM identity alone does not prevent expensive React work: keep the composed host subtree stable (for example, memoized elements keyed by the recipe) while passing the changing clock to Scene. Only components deliberately consuming scene time should rerender for that clock.",
 choices:"Reuse the smallest meaningful component that preserves its data and styling dependencies. If a transparent element lifts from its background, it may need its original backing paint, not invented decoration. Host components may receive an existing supported progress/state prop driven by useSceneTime when internal animation is useful.",
 pitfalls:"Wrapper nodes can break direct-child selectors, flex/grid sizing, list semantics or inherited styling. Put li/tr/other semantic roots in the correct parent and adapt the wrapper placement. Host transforms, filters, opacity, overflow clipping and paint containment on spatial ancestors can flatten 3D; isolate those on visual leaves. Portals may leave the scene. Never duplicate React subtrees to fake focus.",
 verify:"Check normal and scene computed styles, keyboard and pointer interaction, provider requests and DOM identity. Visually inspect clipping, theme, menu behavior and responsive layout. A typecheck cannot prove visual fidelity."},
 {id:"templates",title:"Templates are starting points you own",
 meaning:"A template is a certified first draft of a known shot (hero-push, rack-focus, float-loop) or a whole film (a blueprint such as launch-film-30s). Scaffolding copies plain recipe JSON, a TSX binding and, for blueprints, a composition and brief.md into the project. From then on the files are the creator's: nothing re-reads the template at runtime.",
 mechanism:"velora templates ls --json lists camera, layered, motion-graphics and blueprint entries with their params, aspects and duration range. velora new scene --template ID --id SLUG (--route /path or --component path#Export) writes the recipe and binding; velora new video --blueprint ID writes every scene plus the composition. Recipes record provenance (template id, version, params) so a shot can be re-scaffolded for comparison. In the studio, the Templates tab previews a template live on the real app and copies the exact scaffold command and agent prompt.",
 choices:"Start from a template when the request names a known shot or a launch format; author bespoke when the brief needs a move no template makes. After scaffolding, replace placeholders with real components, then refine framing, focus and timing by hand. Across a film, vary template families so consecutive shots differ in size, angle or movement.",
 pitfalls:"Do not repeat one template for every scene, keep SlotPlaceholder content in a delivered render, or treat template defaults as rules: user direction overrides them. Certification (velora templates check) proves framing, determinism and budget for the shipped defaults, not for your edits.",
 verify:"Run velora validate, then velora shot at the start, middle and end of each scaffolded scene and compare against the brief. Confirm no placeholder remains."},
 {id:"shot-vocabulary",title:"Shot vocabulary: size, angle and one motivated move",
 meaning:"Directors describe a shot by its size (wide, medium, close-up, extreme close-up of a detail), its angle (eye level, low, high, overhead, oblique) and its movement (push, pull, truck, crane, orbit, tilt, rack, hold). In a UI film the subject is a page, a panel or one control; the vocabulary maps directly to camera distance, rotation and travel.",
 mechanism:"Shot size is camera z relative to the subject: a wide shows the page with void around it, a close-up fills the frame with one panel, an extreme close-up isolates a number or button. Angle is camera rotateX/rotateY. Movement is one camera track family sharing timing and easing. Template intensity (subtle, standard, dramatic) scales the same move.",
 choices:"Give each shot one motivated move: a push to direct attention, a pull or crane to reveal context, a truck to survey, a rack to shift attention between depths, a hold to let text read. Alternate sizes across cuts (wide to close, close to medium) so each cut adds information.",
 pitfalls:"Stacking several moves in one shot (push plus orbit plus tilt) reads as noise. Two consecutive shots of the same size and angle feel like a jump cut. A move without a reason is decoration.",
 verify:"Name the size, angle and move of every shot in the brief's shot list, then check the contact sheet (velora frames --contact-sheet) shows that variety."},
 {id:"lens",title:"Lens language",
 meaning:"Focal length sets how space feels. Wide lenses (24-35 mm) exaggerate depth and make near edges loom; normal (50 mm) reads natural; long lenses (85-135 mm) compress layers together and isolate a subject with shallow focus.",
 mechanism:"perspectiveForFocalLength(mm, frameHeight) converts millimetres to CSS perspective and lensFor returns the matching focus focalLength. capabilities.lenses lists the values for common lenses. Animating perspective against camera z keeps the subject's size while the background stretches or compresses: a dolly zoom (the dolly-zoom template).",
 choices:"Use a wide lens for monumental surveys and dramatic near edges, a normal lens for product truth, a long lens for macro details, rack focus and layered parallax that should feel calm. Keep one lens per shot unless the lens change is the effect.",
 pitfalls:"Very wide perspective with large z travel crosses the projection plane. Long lenses flatten depth so parallax nearly disappears; add depth separation if layers should still relate.",
 verify:"Compare a still at 35 mm and at 85 mm for the same framing and confirm the chosen feel serves the brief."},
 {id:"editing-rhythm",title:"Editing rhythm",
 meaning:"Editors weigh a cut by emotion first, then story, then rhythm, then where the eye is on screen. A launch film earns attention in the first two seconds, gives each idea just enough time to read, and lands cuts on the music's pulse.",
 mechanism:"A composition orders segments on V1 with entering or overlap transitions (crossfade, dip, wipe, push, whip and others), overlays on V2/V3, markers for sections and music cues, captions and sound. velora audio beats finds tempo and beats; velora compose snap --to beats moves cuts onto them (dry run until --write). velora review reports hook, pacing per platform, reading time, end-card hold, eye-trace jumps, direction flips, loop seams and off-beat cuts as advice.",
 choices:"Cut on movement or on the beat; use hard cuts for energy, a crossfade for time passing, a whip or push for momentum, a dip to separate sections. Keep the subject near the same screen position across a cut when continuity matters, or break it deliberately. Let the end card hold for at least two seconds.",
 pitfalls:"Transitions on every cut, shots longer than the platform's attention span, text that disappears before it can be read, and a hook that arrives after three seconds. Advisories are questions, not rules.",
 verify:"Run velora review --composition FILE --platform ID and look at a contact sheet of the cut points. Watch the draft at full speed with sound before the master render."},
 {id:"brand-and-looks",title:"Brand and looks",
 meaning:"Brand tokens (colors, fonts, logo, radius, motion personality) make motion graphics and kit components look like the product. A look grades the whole frame (contrast, color, grain, vignette, bloom) the way a colorist finishes a film.",
 mechanism:"velora brand init writes velora.brand.json, optionally seeded from the app's CSS; kit components and motion-graphics templates read it through BrandProvider. Motion personalities (calm, crisp, playful, bold) choose easing and duration defaults. Looks are presets (clean, film, noir, teal-orange, neon, pastel, keynote) with a browser layer that matches export, plus export-only finishing previewed with velora shot --finish. velora check reports flash risk and banding.",
 choices:"Seed the brand from the real CSS so titles match the product. Pick one personality for the whole film. Choose a look that supports the product's tone and keep it consistent across shots; subtle grades age better than strong ones.",
 pitfalls:"Grading the live UI into colors the product does not have, mixing looks between shots, heavy grain on small text, and fast bright flashes (checked against WCAG 2.3.1).",
 verify:"Run velora brand check, preview a graded still with velora shot --finish, and confirm velora check reports no flash failure."},
 {id:"delivery",title:"Inspect before exporting",
 meaning:"A scene is finished when its real rendered behavior communicates the intended reveal, not merely when its configuration validates.",
 mechanism:"Use ScenePreview from "+VELORA_PACKAGE.preview+" for the shared product interface. It owns paused playback, seek/replay, source validation/recovery, viewport fitting and the capture bridge, using the canonical Scene and motion clock. Supply stable Surface children and a definition containing scene metadata, optional motion, width and height. Pass hot={import.meta.hot} in Vite for update/error/reconnection feedback. For a deliberately custom low-level integration, Scene, motionDuration, SceneErrorBoundary and useSceneCapture remain available; do not register a second capture bridge inside ScenePreview. velora export samples the same live scene at exact frame times using FFmpeg; FPS controls cadence, not speed.",
 choices:"Preview first and revise code through the existing development server. Export only when requested, choosing the requested output cadence. The installed CLI does not need an AI login and does not infer a page's private data. Existing coding agents inspect the host project and use their own credentials/subscription tooling.",
 pitfalls:"Start with velora guide. reviewAuthoring checks supplied scene and motion metadata. Confirm actual registration, framing and readability in the browser. Templates scaffold editable source and the Studio edits that source through a local bridge.",
 verify:"Run host types/build, inspect Scene diagnostics and actual registered IDs, scrub several frames, test interaction/reduced motion/mobile and measure playback. Register capture before exporting; use a fresh relative MP4 output path. Compare exported frames with preview and confirm duration/cadence. Record unresolved limits honestly."},
 {id:"app-stage",title:"App stage and output frame",
 meaning:"The app lays out at a concrete CSS viewport. Export dimensions choose the video pixels independently.",
 mechanism:"AppStage creates a named size container. RouteFrame without width or height inherits that box, so viewport media queries see its logical dimensions.",
 choices:"Start new app shots at laptop-14 (1512 × 982 @2×). Choose laptop-13 for compact layouts or use the Studio to save the actual viewport.",
 pitfalls:"Use RouteFrame for window media queries and AppStage container queries for in-tree UI. A raster close-up can exceed the available DPR even when the layout is correct.",
 verify:"Run velora inspect --scene ID --json for the stage budget and test a close-up with velora shot."},
 {id:"editor",title:"Studio edits and agent handoff",
 meaning:"Studio and coding agents edit the same scene or composition JSON. A gesture is an EditOp batch with a diff and an inverse.",
 mechanism:"Open a running project with velora edit --scene ID or velora edit --composition FILE. The authenticated loopback bridge writes validated text using SHA-256 compare-and-swap. Scene batches use velora edit apply and composition batches use velora compose edit.",
 choices:"Use the scene timeline and graph for timing, the viewport for framing, and the composition lanes for cutting. Ask agent copies the selection, playhead and history into a prompt for the coding agent you choose.",
 pitfalls:"Use --expect-sha for agent writes. When a file changes, re-read it and regenerate the dry run. Review source promotion diffs before confirming a JSX edit.",
 verify:"Check the JSON diff and scrub both endpoints of the affected range. Undo one gesture to confirm the expected history boundary."},
 {id:"clips-groups",title:"Clips and groups share timing",
 meaning:"A clip packages related tracks under one local timing window. A Surface group controls spatial ancestry.",
 mechanism:"Clip timing maps presentation onto authored keys through trim, speed, play count, easing and stagger. Replace and additive clips compose in the same evaluator.",
 choices:"Group selected tracks into a clip for a shared entrance. Stagger ordered layers to guide reading, and keep the final poses settled.",
 pitfalls:"Ungrouping a clip with nonlinear retiming can require baking. Review the sampled deviation before applying a baked result.",
 verify:"Scrub the first key, overlap, and landing. Confirm the group retains the source layout and intended reading order."},
 {id:"paths-constraints",title:"Paths and spatial constraints",
 meaning:"Position paths describe movement through space. Constraints solve camera aim and focus against the evaluated scene.",
 mechanism:"Position tracks use cubic paths and arc-length tables. lookAt aims the camera at its target and focusFollow derives the focal distance from target depth.",
 choices:"Use a continuous path for travel or an orbit. Constrain aim and focus when the target's depth changes over the shot.",
 pitfalls:"Choose either a position path or x/y/z tracks for the same target, and keep linked properties acyclic.",
 verify:"Inspect the path through the frame and check the subject at the start, middle and end."},
 {id:"animatables",title:"Expose typed component controls",
 meaning:"Animatables let the timeline control component values such as a chart reveal, label state or color.",
 mechanism:"useAnimatable registers number, color, boolean and enum props. Channel tracks write those values through the scene clock. TextAnimator exposes reveal and selector channels for scrubbing text.",
 choices:"Expose an existing component prop where the intended animation has semantic meaning. Use the JSX source outline to review supported promotion or prop-exposure edits.",
 pitfalls:"Keep component data and providers in the host. A boolean or enum is a discrete state, so choose switch timing explicitly.",
 verify:"Check the live Animatables group and seek backward and forward to the same frame."},
 {id:"style-color",title:"Style variables and color",
 meaning:"Surface style tracks animate CSS custom properties that ordinary components can consume.",
 mechanism:"Number tracks carry units. Color values interpolate in OKLab with premultiplied alpha.",
 choices:"Use a custom property to animate an accent, gradient component or local effect while preserving the existing host CSS.",
 pitfalls:"Use explicit supported color values. Preserve legibility throughout the move and keep direct layout work out of the scene clock.",
 verify:"Inspect the intermediate color as well as both endpoints in the real component."},
 {id:"three",title:"Three.js inside the scene clock",
 meaning:"The optional Three.js entry renders a model as a Surface alongside live DOM UI.",
 mechanism:"React 19 hosts with React Three Fiber 9 and Three.js can import ThreeSurface, Animated and useGLTFClips from the /three entry. Scene time drives the renderer and glTF clip sampling. Registered objects supply channels, picks, gizmos and anchors.",
 choices:"Use an isolated canvas camera or the shared camera when DOM and 3D need the same projection. Keep the canvas asset loading path observable.",
 pitfalls:"Keep model time absolute. Avoid independent tickers, accumulated delta or editing Three.js internals from the Studio.",
 verify:"Seek to the same time after a backward scrub and compare the resulting frame with capture."},
];
export function getAuthoringGuide(input?: { cliVersion?: string }): AuthoringGuide {
  const {items: _items,...cascadeDefaults}=CascadeSchema.parse({items:[{id:"subject"}]});
  return AuthoringGuideSchema.parse({
    version:4,
    cliVersion: input?.cliVersion ?? "development",
    commands: [...CLI_COMMANDS],
    stageBackdrop:SCENE_BACKGROUND,
    purpose:"Compose cinematic 3D motion from a requested application's existing live UI. Teach a spatial language, not a prescribed design.",
    creativeFreedom:"Concepts explain effects and tradeoffs. The stage is always a black void; the host UI keeps its original theme. No fixed camera angle, path, layout, focus target, layer count or entrance pattern is mandatory. User direction overrides artistic defaults. Technical schema/identity constraints still apply. For multiple scenes choose different compositional ideas, not just different labels or durations. Templates are starting points; vary shot families across scenes; user direction overrides.",
    concepts,
    workflow:[
      "Start with the project-root VELORA.md handoff created by npx velora init. Read npx velora guide --json for this installed version, then inspect the requested page, original components, providers, styles and existing app entry. Do not start by copying a demo.",
      "If the request matches a known shot, start from a certified template: run velora templates ls --json, then velora new scene --template <id> --id <slug> with --route /path (zero code) or --component path#Export (real subtree). The scaffolded recipe and binding are ordinary files to refine below; vary templates across scenes rather than repeating one.",
      "Choose a shot family and layout relationship: surface travel, plating, micro detail or floating foreground, or a deliberate variation. State the near edge/corner, subject, camera distance, one travel axis, focus region and visible depth references. Choose camera framing before object animation.",
      "Approve the opening still visually before adding motion: strong near/far perspective, intentional close crop, identifiable detail and visible progressive focus in black void. Reject a small flat overview when the request calls for a dramatic shot. Reference images establish composition cues; motion direction comes from the brief, not a still image.",
      "Compose real components as stable Surface children of ScenePreview from "+VELORA_PACKAGE.preview+", using canonical motion helpers and matching scene node metadata. Keep the normal app available. Use an authored scene route without velora-preview=1: that query activates the separate ProjectPreview bootstrap around the whole app. Do not nest the two previews. For automatic discovery instead use src/velora/scenes/<id>.scene.json plus matching <id>.tsx: the library owns ScenePreview around the selected component, so that component returns Surface content, not another preview shell.",
      "Use reviewAuthoring on the supplied metadata, host checks and the live scene diagnostics. Inspect actual browser frames and fix fidelity, framing, clipping and performance issues.",
      "For a Studio handoff, capture the selected tracks or cut, playhead and edit intent with Ask agent. Dry-run the matching scene or composition operation and pin the reviewed SHA before writing.",
      "Use the scene library at ?velora-preview=1. Adding a valid recipe/component pair automatically adds a row; ?velora-preview=1&velora-scene=<id> deep-links it. The installed entry must include the DEV-only sceneModules glob; rerun velora init to upgrade older wrappers. The catalog is code-driven, not a separate database. Native list scrolling keeps its camera/focus fixed. After creating or revising each scene, run velora snapshot --scene <id> --url <running-app-url> to save its real PNG thumbnail in the recipe; use --time <milliseconds> to choose a frame (default midpoint). Snapshots are local cached images of rendered host data, not live tile animations; regenerate them after changing the scene.",
      "Show the shared paused product preview. Revise source code from user feedback; do not recreate playback or diagnostic controls per scene. ScenePreview registers capture for static and animated scenes and exposes the canonical CLI export command when valid. Export only when requested.",
    ],
    capabilities:{
      brand:VELORA_BRAND,
      package:{name:VELORA_PACKAGE.name,preview:VELORA_PACKAGE.preview},
      example:{
        purpose:"A tested file-pair contract, not a mandatory composition. Replace the host import with the requested app's actual component and its existing providers. Choose framing, dimensions and focus for that content; do not recreate its UI.",
        recipePath:`${SCENE_RECIPE_DIRECTORY}/page-survey.scene.json`,
        componentPath:`${SCENE_RECIPE_DIRECTORY}/page-survey.tsx`,
        recipe:SceneRecipeSchema.parse({version:1,id:"page-survey",title:"Page survey",definition:{
          width:1400,height:980,
          scene:{camera:{perspective:1400,rotateY:-24,rotateX:10},focus:{distance:1400,fStop:5.6,focalLength:100,maxBlur:6},nodes:[{id:"page"}]},
          motion:{durationMs:6000,tracks:[{target:{kind:"camera"},property:"y",keyframes:[{timeMs:0,value:-100},{timeMs:6000,value:100}]}]},
        }}),
        componentSource:`import { Surface } from '${VELORA_PACKAGE.name}';
import { App, DashboardProvider } from '../../App';

export default function PageSurvey() {
  return <DashboardProvider><Surface id="page" style={{ width: 1400, height: 980 }}><App /></Surface></DashboardProvider>;
}
`,
      },
      sceneVersion:SceneSchema.parse({nodes:[]}).version,
      camera:CameraSchema.parse({}),focus:FocusSchema.parse({}),surface:TransformSchema.parse({}),
      motionDefaults:MotionSchema.parse({durationMs:0,tracks:[]}),
      tracks:MotionTrackSchema.options.map(option=>({target:option.shape.target.shape.kind.value as string,properties:"options" in option.shape.property?[...option.shape.property.options]:"value" in option.shape.property?[option.shape.property.value as string]:["--<name>"]})).reduce<{target:string,properties:string[]}[]>((all,entry)=>{const prior=all.find(other=>other.target===entry.target);if(prior){for(const property of entry.properties)if(!prior.properties.includes(property))prior.properties.push(property);}else all.push({target:entry.target,properties:[...entry.properties]});return all;},[]),
      cascadeDefaults,
      easingDefault:MotionKeyframeSchema.parse({timeMs:0,value:0}).easing,
      easings:{names:[...EASING_NAMES],auto:"keyframe easing \"auto\": per-keyframe auto-bezier (monotone cubic Hermite through neighbors, continuous velocity, no overshoot); numeric keyframes only",cubicBezier:"{cubicBezier:[x1,y1,x2,y2]} with x in 0..1",spring:"{spring:{stiffness?:170,damping?:26,mass?:1}}",steps:"{steps:n,jump?:'end'|'start'}"},
      trackOptions:{interpolation:["segments","smooth"],ease:"smooth tracks only: one easing across the whole track",noise:"{amplitude,frequency?:0.5,octaves?:2,seed?:0} on position, rotation and channel tracks"},
      surfaceVisuals:[...SURFACE_VISUAL_PROPERTIES],
      grade:"brightness/contrast/saturate 0..4, hueRotate -360..360 deg, grayscale 0..1: content leaf only, composed after focus and artistic blur",
      transformAdditions:{scaleX:"(0,100] multiplies scale",scaleY:"(0,100]",scaleZ:"(0,100]",skewX:"-89..89 deg",skewY:"-89..89 deg",originX:"-100..200 % pivot (default 50)",originY:"-100..200 % pivot (default 50)",order:"translate3d rotateX rotateY rotateZ scale scale3d skew"},
      styleTracks:"{target:{kind:'style',id:<surface id>},property:'--name',keyframes:[{timeMs,value:number}],unit?:'px'|'%'|'deg'|'em'|'rem'|'vw'|'vh'|''} or color keyframes {timeMs,value:'#rrggbb'|rgb()|hsl()|oklab()|oklch(),easing?}; the Surface's outer element gets the custom property and descendants read var(--name). Colors blend in OKLab with premultiplied alpha and print rgb(R G B / A); named colors are rejected.",
      animatables:"useAnimatable(id, {prop:{type:'number',default,min?,max?,step?,unit?,label?}|{type:'color',default}|{type:'boolean',default}|{type:'enum',options,default}}, {channels?}) returns typed values at scene time from channel tracks <id>.<prop> (numbers clamp, booleans switch at 0.5, enums hold the rounded index; color props take color keyframes). Kit Title, Counter, Typewriter and Callout accept id: an <id>.reveal track (0..1) scrubs their reveal span.",
      clips:"motion.clips[] {id,label?,startMs,speed?,inMs?,durationMs?,loop?:false|count,ease?,mode?:'replace'|'add',tracks?,clips?(nest <=4),members?,stagger?:{eachMs,order?:'forward'|'reverse'|'center-out'|'edges-in'|{random:seed},ease?},source?}: local = inMs + ease((t - startMs) * speed / span) * span; holds local 0 before and the end after; one replace owner per property; add clips sum offsets (onto the static base without an owner). Stagger tracks target {kind:'surface',id:'$member'}; member offset = ease(position) * eachMs * (n - 1). createCascadeClip builds one.",
      positionPaths:"{target:{kind:'surface',id}|{kind:'camera'},property:'position',keyframes:[{timeMs,value:[x,y,z],easing?,inTangent?,outTangent?}],rove?,orient?:{axis:'yaw'|'yaw-pitch',offsetDeg?}}: cubic Bezier segments (auto Catmull-Rom handles), easing maps time to distance along each segment (64-sample arc-length tables); rove gives constant speed; excludes x/y/z tracks on the same target.",
      links:"motion.links[] {to:TrackRef,from:TrackRef|{channel},scale?:1,offset?:0,delayMs?:0,mode?:'replace'|'add'}: to(t) = from(t - delayMs) * scale + offset; acyclic, chains <= 8, at most 256; no expressions.",
      constraints:"scene.constraints[] (<=16): {kind:'lookAt',subject?:'camera',target:{surface,anchor?:[u,v]}|{point:[x,y,z]},weight?:0..1|channel TrackRef} derives camera rotateX/rotateY so the target is at frame center; {kind:'focusFollow',target,offset?,weight?} sets focus.distance to the target's camera depth. Resolved by evaluateScene with layout; buildOrbitRig({radius,fromDeg,toDeg,height?,durationMs,ease?,target?}) returns {clip, constraint}.",
      recipeEditor:"Optional recipe editor block {labels?,colors?,locked?,markers?:[{atMs,label}]} is editor-owned metadata; the renderer ignores it.",
      templates:{list:"velora templates ls --json",show:"velora templates show --id <id> --json",scaffold:"velora new scene --template <id> --id <slug> [--route /path | --component path#Export] [--set key=value] [--aspect 16:9|21:9|1:1|4:5|9:16]",reel:"velora new video --blueprint <id> --id <slug> [--route /path | --component path#Export]",kit:"@adityadeokar/velora/kit exports RouteFrame, ScrollFrame and SlotPlaceholder for bindings."},
      lenses:[24,35,50,85,135].map(mm=>({mm,perspectiveAt1080:perspectiveForFocalLength(mm,1080),perspectiveAt980:perspectiveForFocalLength(mm,980)})),
      exportFps:SUPPORTED_EXPORT_FPS,
      finishing:{quality:QUALITY_PRESETS,codecs:CODEC_CONTAINERS,alpha:ALPHA_CODECS,motionBlur:"--motion-blur DEG (180 cinematic, 90 crisp UI text, 270-360 dreamy) [--motion-samples 2-64]; averaged in linear light; static frames stay byte-identical",colorimetry:"BT.709 limited range, tagged",posters:"--poster MS writes <out>.poster.png",preview:"velora shot --quality master --motion-blur 180 previews finishing on one frame"},
      prompts:{list:"velora prompts ls --json",show:"velora prompts show --id <id> --json",ids:PROMPT_LIBRARY.map(prompt=>prompt.id)},
      editorial:{beats:"velora audio beats --composition FILE [--write-markers] --json",snap:"velora compose snap --composition FILE --to beats|downbeats [--write] --json",review:"velora review --composition FILE [--platform ID] --json",transitions:"velora transitions ls --json"},
      editor:{scene:"velora edit --scene ID",composition:"velora edit --composition FILE",sceneOps:"velora edit apply --scene ID --ops FILE --json",compositionOps:"velora compose edit --composition FILE --ops FILE --json",source:"velora edit source outline --scene ID --json",presets:"velora edit preset ls --json"},
      stages:{presets:STAGE_PRESETS,dprs:STAGE_DPRS,default:DEFAULT_STAGE,custom:"--stage WxH@DPR",edit:"velora edit stage --scene ID --preset laptop-13"},
      brandAndLooks:{brand:"velora brand init [--from-css FILE] --json; velora brand check --json",finishPreview:"velora shot --scene ID --time MS --finish --out PNG --json"},
      presets:"velora render --composition FILE --out VIDEO --preset <id>; the delivery list below names each preset.",
      deliver:"velora deliver --composition FILE --targets youtube,x,linkedin,reels,tiktok,shorts,website-hero,readme-gif,og-image,product-hunt [--out DIR] --json: every platform file within its size budget, website-hero embed snippets, stills and deliverables.json.",
      setup:{reactApp:"velora init",anySite:"velora studio --site <loopback dev URL> (non-React sites: route-level shots through a same-origin proxy; nothing installed into the project)",noApp:"velora create <dir> (starter launch studio)"},
      delivery:DELIVERY_PRESETS.map(preset=>({id:preset.id,title:preset.title,size:`${preset.width}x${preset.height}`,fps:preset.fps,codec:preset.codec,lastVerified:preset.lastVerified})),
      api:{
        hostIntegration:{
          contract:"Framework-independent React DOM 18.2+ / 19. Import ProjectPreview from "+VELORA_PACKAGE.preview+", supply projectId, enabled (the host development flag), optional active (route-based opt-in), sceneModules (path -> async module loader), and original children. No Vite, Next, Node or Electron global is required by this React contract. ScenePreview/Scene/Surface work directly in any compatible React DOM renderer.",
          setup:"npx velora init detects Next App/Pages Router and standard Vite setups. Next adds /velora without rewriting layouts/config/providers; it returns 404 outside development. Unknown hosts get src/velora/ProjectPreview.jsx and VELORA.md. --adapter react selects that portable connection explicitly even in a known framework. Follow init's integration.instructions: mount the generated wrapper inside required providers with enabled={yourDevelopmentFlag}; the query is ?velora-preview=1 or pass active for a dedicated route. For production code exclusion in a custom host, place the generated module import behind that bundler's compile-time development condition; a runtime enabled prop prevents activation but cannot erase imports from a build. Do not replace the host framework or create a new root.",
          registry:"After adding or deleting scene/component files outside the Vite glob, run npx velora sync. Edit JSON/components normally and let the host's HMR update them. Do not edit generated catalog.js or duplicate its loader. CLI discovery validates through the same core contract as the browser.",
          boundaries:"Next scenes are client components; do not import server-only modules or async Server Components into the client registry. Reuse client UI and pass required server data through the host boundary. Studio inherits route-layout providers; scene-specific providers belong in the scene binding. Electron uses this in its React renderer, never its main/preload process. Its security, navigation and bundler remain host-owned. React Native without DOM is outside this renderer. Unknown wrappers need one explicit host connection, not guessed entry rewrites.",
          example:"import {VeloraProjectPreview} from './velora/ProjectPreview'; <ExistingProviders><VeloraProjectPreview enabled={hostDevelopmentFlag}><ExistingApp /></VeloraProjectPreview></ExistingProviders>",
        },
        recipes:"src/velora/scenes/<id>.scene.json contains {version:1,id,title,description?,definition:{scene,motion?,width?,height?}}. Lowercase slug id matches both filename and sibling <id>.tsx or <id>.jsx default component export (one, not both). The component returns actual Surface subtrees matching definition.scene.nodes; reuse original providers around those subtrees when needed. Do not render Scene/ScenePreview inside it: SceneLibrary supplies them. No serialized React instances, credentials or raw application records. An optional snapshot contains visible rendered pixels; generate it only for the local scene. Keep helpers outside the discovery directory. Unknown versions, missing bindings and duplicate IDs are rejected with repair diagnostics.",
        loadSceneRecipes:"({sources:[{path:'src/velora/scenes/id.scene.json',document:recipeObject}],bindingPaths:['src/velora/scenes/id.tsx'],sceneId?:'id'}) => {scenes,selected?,issues}. Validation does not execute TSX. CLI discovery and the browser adapter call this shared operation for you.",
        catalog:"velora scenes --json lists canonical validated recipes; velora load --scene ID --json returns that source; velora open --scene ID --url ORIGIN verifies the same host before opening the scene. Browser and CLI call loadSceneRecipes through RESOURCES. Vite discovers pairs through its development glob. Other hosts use npx velora sync after adding/removing pairs; their static registry uses ordinary imports and native hot reload. normal app routes and production stay ordinary. Recipe JSON is editable and survives refresh; playback state is in-memory.",
        ScenePreview:"Import from "+VELORA_PACKAGE.preview+". {definition?:{scene:{version?:3,camera?,focus?,nodes:[{id,parentId?,transform?}]},motion?,width?,height?},children?,title?,backHref?,revision?,hot?}; dimensions default to 1400x980. Actual Surface children must match node metadata. No definition displays the empty product state. Owns playback/capture; do not pass a second timeMs or register another capture bridge. revision can signal source changes; Vite hosts pass import.meta.hot explicitly.",
        Scene:"{camera?,focus?,motion?,timeMs?,children?,style?,className?,onDiagnostics?}; no explicit nodes prop: the React adapter registers Surface children.",
        Surface:"{id,transform?,content?,children?,style?,className?}; id is unique within Scene. Motion is an alias, not a timeline component.",
        motion:"{durationMs,speed?,loop?,tracks:[{target:{kind:'surface',id}|{kind:'camera'}|{kind:'focus'}|{kind:'channel',id},property,keyframes:[{timeMs,value,easing?}],interpolation?,ease?,noise?}]}; properties listed above. No targetId, from/to, delay or duration shorthand.",
        useChannel:"useChannel(id, fallback?) inside a Scene returns the channel track's value at the current scene time; drive counters, cursor positions and scroll offsets from it instead of a component clock.",
        reviewAuthoring:"({scene:{version?:3,camera?,focus?,nodes:[{id,parentId?,transform?}]},motion}) => {valid,issues,advice,requiresVisualReview:true}; only metadata, never React nodes or secrets.",
        helpers:"motionDuration, motionTime, evaluateMotion, applyEasing, loopSeam, lensFor, perspectiveForFocalLength, focalLengthForPerspective, createCascadeTracks, cinematicTimeAtProgress, sampleFrameTime, matrixFor, multiply: use installed TypeScript declarations for exact signatures.",
        capture:"useSceneCapture({durationMs:motionDuration(motion),seek}); seek pauses and sets Scene's elapsed time. Exactly one [data-velora-capture=\"scene\"] viewport per registered bridge.",
        export:"npx velora export --url HTTP_LOOPBACK_SCENE_URL --output fresh-name.mp4 --fps 60; requires FFmpeg and Playwright Chromium. Does not start the app server.",
      },
    },
  });
}
export const AuthoringReviewInputSchema=z.strictObject({scene:SceneSchema,motion:MotionSchema,
 stage:StageSchema.optional(), width:z.number().positive().optional(), height:z.number().positive().optional(),
 textReadings:z.array(z.strictObject({id:z.string(),minMs:z.number().finite().positive()})).optional()});
const ReviewIssueSchema=z.strictObject({code:z.string(),path:z.string(),message:z.string()});
export const AuthoringReviewSchema=z.strictObject({valid:z.boolean(),issues:z.array(ReviewIssueSchema),advice:z.array(ReviewIssueSchema),requiresVisualReview:z.literal(true)});
export type AuthoringReview=z.infer<typeof AuthoringReviewSchema>;
export function reviewAuthoring(input:unknown):AuthoringReview {
 const parsed=AuthoringReviewInputSchema.safeParse(input);
 if(!parsed.success)return {valid:false,issues:parsed.error.issues.map(i=>({code:"invalid-input",path:i.path.join('.'),message:i.message})),advice:[],requiresVisualReview:true};
 const {scene,motion,textReadings}=parsed.data;
 const issues:AuthoringReview['issues']=[],advice:AuthoringReview['advice']=[];
 const ids=new Set(scene.nodes.map(n=>n.id));
 const expanded=motionTracks(motion);
 for(const {track,owner} of expanded) {
  const path=`motion.${owner}`;
  if((track.target.kind==='surface'||track.target.kind==='style')&&!ids.has(track.target.id))issues.push({code:'unknown-surface',path:`${path}.target.id`,message:`No supplied surface ${track.target.id}. Compare with actual React registration too.`});
  if(track.property.startsWith('rotate')&&track.keyframes.some((f,k)=>k>0&&Math.abs(Number(f.value)-Number(track.keyframes[k-1].value))>90))advice.push({code:'rotation-sweep',path,message:'A rotation segment over 90 degrees may show the edge/back or hide the UI. Inspect the path; retain it only when intentional.'});
  if(track.target.kind==='camera'&&(track.interpolation==='smooth'?track.ease!==undefined&&easingOvershoots(track.ease):track.keyframes.some((f,k)=>k<track.keyframes.length-1&&easingOvershoots(f.easing as Parameters<typeof easingOvershoots>[0]))))advice.push({code:'camera-overshoot',path,message:'An overshooting easing (back, elastic, under-damped spring) on a camera track reads as a jolt. Keep it only for an intentional snap; prefer cinematic or an out curve.'});
  if(track.interpolation==='smooth'&&track.keyframes.slice(0,-1).some(f=>f.easing!=='cinematic'))advice.push({code:'smooth-easing-ignored',path,message:'Smooth tracks ignore per-keyframe easing; set the track-level ease instead.'});
  if(track.interpolation!=='smooth'&&track.keyframes.some((f,k)=>k<track.keyframes.length-1&&f.easing==='linear'&&f.value!==track.keyframes[k+1].value))advice.push({code:'linear-motion',path,message:'Linear movement has no gentle start/finish. Confirm that this override serves the intended shot.'});
 }
 for(const [i,link] of (motion.links??[]).entries()) for(const ref of [link.to,link.from]) if('target' in ref&&(ref.target.kind==='surface'||ref.target.kind==='style')&&!ids.has(ref.target.id))issues.push({code:'unknown-surface',path:`motion.links.${i}`,message:`No supplied surface ${ref.target.id}.`});
 for(const {owner,speeds,rove} of pathSpeeds(motion)){const moving=speeds.filter(v=>v>1e-9);if(!rove&&moving.length>1&&Math.max(...moving)/Math.min(...moving)>4)advice.push({code:'path-speed-spike',path:`motion.${owner}`,message:'Path segments change speed more than 4x between keyframes, which reads as a lurch. Even out keyframe times, ease the segments or set rove: true for constant speed.'});}
 const changes=(track:typeof motion.tracks[number])=>!!track.noise?.amplitude||track.keyframes.some(f=>f.value!==track.keyframes[0].value);
 const tracks=expanded.map(({track})=>track);
 const cameraTravels=tracks.some(t=>t.target.kind==='camera'&&['x','y','z'].includes(t.property)&&changes(t));
 const surfacesMove=motion.tracks.some(t=>t.target.kind==='surface'&&['x','y','z','rotateX','rotateY','rotateZ','scale'].includes(t.property)&&changes(t));
 if(surfacesMove&&!cameraTravels)advice.push({code:'camera-travel-missing',path:'motion.tracks',message:'Surfaces move but the camera has no translational travel. Default dramatic shots establish a close oblique camera and a surface-aligned rail. Keep this stationary-camera variation only when intentional; element movement alone does not prove the requested shot.'});
 if(!tracks.some(changes))advice.push({code:'static-scene',path:'motion',message:'There is no changing track. A static composition is valid, but does it meet a request for cinematic motion?'});
 const duration=motionDuration(motion);
 if(parsed.data.stage) {
  const stage = parsed.data.stage, frame = { width: parsed.data.width ?? 1400, height: parsed.data.height ?? 980 };
  const budget = sceneStageBudget({ stage, frame, scene, motion, effectiveDpr: resolveFinishing({}, frame, stage).supersample });
  if(budget.undersampled) advice.push({code:"stage-undersampled",path:"definition.stage",message:`Raster content may soften near ${Math.round(budget.timeMs)}ms (${budget.pixelsPerCssPixel.toFixed(2)} output pixels per CSS pixel at ${budget.effectiveDpr}× capture). Use a higher stage DPR, master quality, a longer lens from farther away, or a lower fill.`});
 }
 for(const {id,minMs} of textReadings??[])if(duration>0&&duration<minMs)advice.push({code:'reading-time',path:`animatable.${id}`,message:`Text animator ${id} needs about ${minMs} ms of readable time. The full scene is ${Math.round(duration)} ms.`});
 if(motion.loop&&loopSeam(motion)>1e-6)advice.push({code:'loop-seam',path:'motion.loop',message:'This loop does not return to its first frame, so playback will jump at the seam. End every track on its starting value.'});
 if(scene.focus.maxBlur===0)advice.push({code:'sharp-scene',path:'scene.focus.maxBlur',message:'Focus softness is disabled initially. This can be intentional; inspect whether the composition still directs attention.'});
 if(motionDuration(motion)>0&&!CaptureManifestSchema.safeParse({version:1,durationMs:motionDuration(motion),selector:'[data-velora-capture="scene"]'}).success)advice.push({code:'export-duration',path:'motion.durationMs',message:'This timeline exceeds the current MP4 capture duration limit. Shorten it or present it without that export adapter.'});
 return {valid:issues.length===0,issues,advice,requiresVisualReview:true};
}
