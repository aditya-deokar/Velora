import { describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli";
import { CliEnvelopeSchema } from "../../src/core/cli-schema";

const context = { root: "/project" };
function envelope(text: string) {
  const parsed = JSON.parse(text);
  expect(CliEnvelopeSchema.safeParse(parsed).success, text).toBe(true);
  return parsed;
}
// runTransitionsCommand is pure (no managers, no I/O): no mocks needed.
describe("transitions command", () => {
  it("lists the catalog with envelope", async () => {
    const result = await runCli(["transitions", "ls", "--json"], context, vi.fn());
    expect(result.code).toBe(0);
    const body = envelope(result.stdout);
    expect(body).toMatchObject({ success: true, command: "transitions" });
    expect(body.data.transitions.map((t: { type: string }) => t.type)).toEqual(
      ["cut", "dissolve", "slide-push", "wipe-mask", "iris-mask", "depth-dolly", "focus-pull", "cascade-handoff",
        "crossfade", "dip-to-black", "dip-to-white", "wipe", "iris", "push", "zoom", "whip", "light-leak"]);
    expect(body.data.transitions.find((t: { type: string }) => t.type === "whip").mode).toBe("overlap");
    expect(body.data.transitions.find((t: { type: string }) => t.type === "dissolve").mode).toBe("entering");
    const human = await runCli(["transitions", "ls"], context, vi.fn());
    expect(human.stdout).toContain("dissolve	entering");
    expect(human.stdout).toContain("crossfade	overlap");
  });
  it("describes one transition with real example tracks", async () => {
    const result = await runCli(["transitions", "describe", "--type", "dissolve", "--json"], context, vi.fn());
    expect(result.code).toBe(0);
    const body = envelope(result.stdout);
    expect(body.data.type).toBe("dissolve");
    expect(body.data.example.tracks).toMatchObject([{ target: { kind: "surface", id: "main" }, property: "opacity" }]);
    const camera = await runCli(["transitions", "describe", "--type", "depth-dolly", "--json"], context, vi.fn());
    expect(envelope(camera.stdout).data.example.tracks).toMatchObject([{ target: { kind: "camera" } }]);
  });
  it("fails closed on unknown types and malformed invocations", async () => {
    const unknown = await runCli(["transitions", "describe", "--type", "melt", "--json"], context, vi.fn());
    expect(unknown.code).toBe(1);
    expect(envelope(unknown.stderr).issues[0].code).toBe("ERR_TRANSITION_INVALID");
    for (const args of [["transitions", "--json"], ["transitions", "wipe", "--json"], ["transitions", "describe", "--json"], ["transitions", "ls", "--wat", "--json"]]) {
      const result = await runCli(args, context, vi.fn());
      expect(result.code).toBe(2);
      expect(envelope(result.stderr).issues[0].code).toMatch(/ERR_(MISSING_VALUE|UNKNOWN_COMMAND|UNKNOWN_OPTION)/);
    }
  });
  it("documents transitions in help", async () => {
    const help = await runCli(["transitions", "--help"], context, vi.fn());
    expect(help.stdout).toContain("transitions describe");
    expect((await runCli(["help", "transitions"], context, vi.fn())).stdout).toBe(help.stdout);
    expect((await runCli(["--help"], context, vi.fn())).stdout).toContain("velora transitions");
  });
});
