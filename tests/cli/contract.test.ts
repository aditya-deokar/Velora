import { describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli";
import { CLI_COMMANDS, CliFailureSchema, CliIssueSchema, CliSuccessSchema } from "../../src/core/cli-schema";
import { resolveFinishing } from "../../src/core/export";
import contract from "./fixtures/v1-command-contract.json";

const environment = { root: process.cwd() };

describe("1.0 CLI contract", () => {
  it.each(contract.commands)("$name keeps its flags and help entry point", async ({ name, flags }) => {
    expect(CLI_COMMANDS.find(command => command.name === name)?.flags).toEqual(expect.arrayContaining(flags));
    const result = await runCli([name, "--help"], environment);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain(`velora ${name}`);
  });

  it("keeps the JSON envelope and exit conventions", async () => {
    for (const [schema, fields] of [[CliSuccessSchema, contract.envelopes.success],
      [CliFailureSchema, contract.envelopes.failure], [CliIssueSchema, contract.envelopes.issue]] as const) {
      expect(Object.keys(schema.shape)).toEqual(expect.arrayContaining(fields));
    }
    const execute = vi.fn().mockResolvedValue({ success: true, data: { scenes: [] } });
    const success = await runCli(["scenes", "--json"], environment, execute);
    expect(success.code).toBe(0);
    expect(JSON.parse(success.stdout)).toMatchObject({ success: true, command: "scenes", data: { scenes: [] } });
    const failure = await runCli(["scenes", "--unsupported-flag", "--json"], environment, execute);
    expect(failure.code).toBe(2);
    expect(JSON.parse(failure.stderr)).toMatchObject({ success: false, issues: [{ code: "ERR_UNKNOWN_OPTION" }] });
  });

  it("keeps the documented render and cut-snapping defaults", async () => {
    expect(resolveFinishing({}, { width: 1920, height: 1080 })).toMatchObject({
      quality: "standard", codec: "h264", supersample: 1, motionBlur: 0, motionSamples: 0,
    });
    const help = await runCli(["compose", "--help"], environment);
    expect(help.stdout).toContain("default 120 ms");
    expect(help.stdout).toContain("dry-run");
    expect((await runCli(["snapshot", "--help"], environment)).stdout).toContain("default midpoint");
    expect((await runCli(["frames", "--help"], environment)).stdout).toContain("one frame per second");
  });
});
