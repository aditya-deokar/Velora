/** SOURCE OF TRUTH: tint.
 * WHAT: a brand color at a given opacity, for any CSS color syntax (hex, rgb, hsl, oklch, names).
 * WHY: appending hex alpha ("#7c5cff55") only works for hex; brands seeded from CSS often use hsl() or oklch().
 * WHERE: kit atmosphere and panels.
 */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${Math.max(0, Math.min(100, Math.round(percent)))}%, transparent)`;
}
