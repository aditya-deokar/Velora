import { z } from "zod";
import { MotionTrackSchema, MEMBER_PLACEHOLDER, type MotionTrack, type MotionClipInput } from "./motion";
/** SOURCE OF TRUTH: CascadeSchema, createCascadeTracks, createCascadeClip.
 * WHAT: ordered depth entrances with overlapping, softly eased settling.
 * WHY: authored scenes and agents share one staircase recipe with an explicit opt-out.
 * WHERE: callers bind existing IDs; MotionSchema owns speed and interpolation.
 */
export const CascadeSchema = z.strictObject({
  items: z.array(z.strictObject({id: z.string().min(1), atMs: z.number().finite().nonnegative().optional()})).min(1),
  cascade: z.boolean().default(true),
  depth: z.number().finite().nonnegative().default(80),
  depthStep: z.number().finite().nonnegative().default(12),
  staggerMs: z.number().finite().nonnegative().default(180),
  entranceMs: z.number().finite().positive().default(1800),
}).superRefine((value,ctx)=>{
  if(new Set(value.items.map(item=>item.id)).size!==value.items.length)
    ctx.addIssue({code:"custom",path:["items"],message:"Cascade IDs must be unique."});
});
export type CascadeInput = z.input<typeof CascadeSchema>;
export function createCascadeTracks(input: CascadeInput): MotionTrack[] {
  const options=CascadeSchema.parse(input);
  return options.items.map((item,index)=>{
    const at=item.atMs ?? (options.cascade ? index*options.staggerMs : 0);
    const depth=options.depth+(options.cascade ? index*options.depthStep : 0);
    return MotionTrackSchema.parse({target:{kind:"surface",id:item.id},property:"z",keyframes:[
      {timeMs:0,value:depth}, ...(at>0 ? [{timeMs:at,value:depth}] : []),
      {timeMs:at+options.entranceMs,value:0},
    ]});
  });
}
/** The same cascade as one clip: a stagger clip (members offset by staggerMs) when every item shares one
 * depth and the default timing, otherwise a plain clip wrapping the cascade tracks. Evaluates equal to
 * createCascadeTracks. */
export function createCascadeClip(input: CascadeInput, id = "cascade"): MotionClipInput {
  const options = CascadeSchema.parse(input);
  const uniform = options.cascade && options.depthStep === 0 && options.items.every(item => item.atMs === undefined);
  if (!uniform || options.items.length < 2) return { id, label: "Cascade", startMs: 0, tracks: createCascadeTracks(input) };
  return {
    id, label: "Cascade", startMs: 0,
    members: options.items.map(item => item.id),
    stagger: { eachMs: options.staggerMs, order: "forward" },
    tracks: [{ target: { kind: "surface", id: MEMBER_PLACEHOLDER }, property: "z", keyframes: [{ timeMs: 0, value: options.depth }, { timeMs: options.entranceMs, value: 0 }] }],
  };
}
