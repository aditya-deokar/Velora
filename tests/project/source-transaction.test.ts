import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareSourceEdit, recoverSourceTransaction, writeSourceTransaction } from "../../src/project/source-edit";
import * as services from "../../src/project/services";

const jsx = "src/velora/scenes/scene.jsx", recipe = "src/velora/scenes/scene.scene.json", journal = ".velora/journal/source.json";
const changes = [{ file: jsx, before: "old JSX\r\n", after: "changed JSX\r\n" }, { file: recipe, before: "{}\r\n", after: '{"id":"scene"}\r\n' }];
let root: string;
const file = (target: string) => path.join(root, target);
const read = (target: string) => readFile(file(target), "utf8");
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "velora-source-txn-"));
  await mkdir(path.dirname(file(jsx)), { recursive: true });
  await Promise.all(changes.map(({ file: target, before }) => writeFile(file(target), before)));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

it.each([jsx, recipe])("aborts without a partial write when %s changes after preview", async target => {
  await writeFile(file(target), "external edit");
  await expect(writeSourceTransaction(root, changes)).rejects.toMatchObject({ code: "ERR_SOURCE_CONFLICT" });
  expect(await read(target)).toBe("external edit");
  const other = changes.find(item => item.file !== target)!;
  expect(await read(other.file)).toBe(other.before);
  await expect(read(journal)).rejects.toMatchObject({ code: "ENOENT" });
});

it("rolls back the JSX when the recipe changes between writes", async () => {
  const atomicWrite = services.atomicWrite;
  vi.spyOn(services, "atomicWrite").mockImplementation(async (root, target, after, before) => {
    if (target === recipe) await writeFile(file(recipe), "external recipe");
    return atomicWrite(root, target, after, before);
  });
  await expect(writeSourceTransaction(root, changes)).rejects.toMatchObject({ code: "ERR_SOURCE_CONFLICT" });
  expect(await read(jsx)).toBe(changes[0].before);
  expect(await read(recipe)).toBe("external recipe");
  await expect(read(journal)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([false, true])("recovers an interrupted journal, preserving completed writes (%s)", async complete => {
  vi.spyOn(services, "projectProcessIsRunning").mockReturnValue(false);
  await mkdir(path.dirname(file(journal)), { recursive: true });
  await writeFile(file(journal), JSON.stringify({ version: 1, pid: 42, files: changes.map(change => ({ file: change.file, before: change.before, afterSha: services.textSha256(change.after) })) }));
  await writeFile(file(jsx), changes[0].after);
  if (complete) await writeFile(file(recipe), changes[1].after);
  await expect(prepareSourceEdit(root, { kind: "wrap", file: jsx, id: "card", node: `${jsx}#Scene.0:main` })).rejects.toMatchObject({ code: "ERR_SOURCE_CONFLICT" });
  expect(await read(jsx)).toBe(changes[0].after);
  await recoverSourceTransaction(root);
  for (const change of changes) expect(await read(change.file)).toBe(complete ? change.after : change.before);
  await expect(read(journal)).rejects.toMatchObject({ code: "ENOENT" });
});
