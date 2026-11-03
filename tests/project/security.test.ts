import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installPackage } from "../../src/project/services";
import { ExportVideoSchema } from "../../src/core/export";
import { DeliverInputSchema } from "../../src/core/deliverables";
import { isLoopbackUrl, studioWorkspaceFiles } from "../../src/project/studio";

// 1.0 security review: the rules below are the review's findings, pinned as tests.
describe("1.0 security review", () => {
  it.runIf(process.platform === "win32")("never passes cmd metacharacters through the Windows npm shell", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "velora-sec-"));
    try {
      for (const source of ["C:\\pkgs\\velora.tgz & calc", "C:\\x|y.tgz", "C:\\a%PATH%.tgz", 'C:\\"q".tgz'])
        await expect(installPackage(root, source), source).rejects.toMatchObject({ code: "denied-path" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("captures and exports only from HTTP loopback origins without credentials", () => {
    const parse = (url: string) => ExportVideoSchema.safeParse({ url, output: "out.mp4" }).success;
    expect(parse("http://127.0.0.1:5173/?velora-preview=1")).toBe(true);
    for (const url of ["http://example.com/", "http://user:pw@127.0.0.1:5173/", "file:///etc/passwd", "http://127.0.0.1.evil.com/"]) expect(parse(url), url).toBe(false);
    for (const url of ["http://169.254.169.254/", "http://10.0.0.1:4321", "https://localhost.evil.com"]) expect(isLoopbackUrl(url), url).toBe(false);
  });
  it("keeps the any-site proxy on loopback and strips frame headers only in its development server", () => {
    const config = studioWorkspaceFiles("1.0.0")["vite.config.mjs"];
    expect(config).toContain('host: "127.0.0.1"');
    expect(config).toContain("target: config.site");
    // The site origin comes from the run config, which executeStudioCommand writes only after isLoopbackUrl.
    expect(config).not.toMatch(/process\.env\.(?!VELORA_STUDIO_CONFIG)/);
  });
  it("writes deliverables only inside the project", () => {
    for (const out of ["../up", "/abs", "C:/abs", "a/../../b"]) expect(DeliverInputSchema.safeParse({ composition: "c.json", targets: ["youtube"], out }).success, out).toBe(false);
    expect(DeliverInputSchema.safeParse({ composition: "c.json", targets: ["youtube"], out: "deliverables/launch" }).success).toBe(true);
  });
});
