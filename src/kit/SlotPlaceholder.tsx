import type { CSSProperties } from "react";

/** SlotPlaceholder: a labeled stand-in until the template slot holds the real component or route.
 * WHAT: a neutral panel naming the slot and how to fill it; marked data-velora-placeholder.
 * WHY: scaffolded scenes preview immediately without inventing UI; velora validate warns until replaced.
 * WHERE: velora new scene writes it when neither --component nor --route is given.
 */
export function SlotPlaceholder({ name, hint, width, height, style }: { name: string; hint?: string; width: number; height: number; style?: CSSProperties }) {
  return (
    <div data-velora-placeholder={name}
      style={{ width, height, boxSizing: "border-box", padding: 48, borderRadius: 24, border: "2px dashed #5b5b66", background: "#15151a", color: "#f2f2f5", font: "500 28px/1.4 system-ui, sans-serif", display: "flex", flexDirection: "column", justifyContent: "center", gap: 12, ...style }}>
      <strong style={{ fontSize: 34 }}>Slot: {name}</strong>
      <span style={{ color: "#a9a9b4" }}>{hint ?? "Replace this placeholder with your real component and its providers, or a --route of your running app."}</span>
    </div>
  );
}
