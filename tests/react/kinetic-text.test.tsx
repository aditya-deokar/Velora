// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MotionSchema } from "../../src/core/motion";
import { buildKineticTracks } from "../../src/core/typography";
import { KineticText, kineticStyle, kineticWordIds, type KineticTextProps } from "../../src/react/kinetic-text";
import { Scene } from "../../src/react";

afterEach(cleanup);
function show(props: KineticTextProps) {
  return render(<Scene><KineticText {...props} /></Scene>);
}
it("renders single text as one styled Surface leaf", () => {
  show({ id: "title", text: "Hello", style: { family: "Inter", size: 64, color: "#ff0033", align: "left" } });
  const node = screen.getByText("Hello");
  expect(node.tagName).toBe("SPAN");
  expect(node.style.fontFamily).toBe("Inter");
  expect(node.style.fontSize).toBe("64px");
  expect(node.style.color).toBe("rgb(255, 0, 51)");
  expect(kineticStyle({ family: "Inter", size: 64 }).display).toBe("inline-block");
});
it("splits words into stable per-word Surfaces paired with builder tracks", () => {
  show({ id: "line", text: "hello brave world", words: true });
  expect(screen.getByText("hello")).toBeDefined();
  expect(screen.getByText("world")).toBeDefined();
  const ids = kineticWordIds("line", "hello brave world");
  expect(ids).toEqual(["line-w0", "line-w1", "line-w2"]);
  const built = buildKineticTracks("word-cascade", { surfaceIds: ids, durationMs: 2000 });
  expect(MotionSchema.safeParse({ durationMs: 2000, tracks: built.tracks }).success).toBe(true);
  expect(built.tracks.every((t) => t.target.kind === "surface" && ids.includes(t.target.id))).toBe(true);
});
