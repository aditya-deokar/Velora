import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli";
import { CliEnvelopeSchema } from "../../src/core/cli-schema";

function envelope(text: string) {
  const parsed = JSON.parse(text);
  expect(CliEnvelopeSchema.safeParse(parsed).success, text).toBe(true);
  return parsed;
}
// No module mocks here: these tests drive the real caption/audio managers
// against disposable directories (no dev server needed for validation).
describe("captions validation without mocks", () => {
  it("validates a real caption file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "velora-captions-cli-"));
    try {
      await writeFile(path.join(dir, "s.srt"), "1\n00:00:01,000 --> 00:00:02,000\nHi\n");
      const result = await runCli(["captions", "validate", "--file", "s.srt", "--project", dir, "--json"], { root: dir });
      expect(result.code).toBe(0);
      expect(envelope(result.stdout).data.cues).toEqual([{ startMs: 1000, endMs: 2000, text: "Hi" }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("fails closed on missing caption files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "velora-captions-cli-"));
    try {
      const result = await runCli(["captions", "validate", "--file", "gone.srt", "--project", dir, "--json"], { root: dir });
      expect(result.code).toBe(1);
      expect(envelope(result.stderr).issues[0].code).toBe("ERR_CAPTION_INVALID");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
