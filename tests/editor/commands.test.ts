import { describe, expect, it } from "vitest";
import { EDITOR_COMMANDS, TRANSPORT_KEYS, shortcutOf } from "../../src/editor/commands";
import { transportTarget } from "../../src/preview/transport";

describe("EDITOR_COMMANDS", () => {
  it("has unique ids and no shortcut collisions", () => {
    expect(new Set(EDITOR_COMMANDS.map(command => command.id)).size).toBe(EDITOR_COMMANDS.length);
    const shortcuts = EDITOR_COMMANDS.flatMap(command => command.shortcuts);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });
  it("never takes a transport key", () => {
    for (const shortcut of EDITOR_COMMANDS.flatMap(command => command.shortcuts)) expect(TRANSPORT_KEYS, shortcut).not.toContain(shortcut);
    // Every unmodified editor key is not a transport key either.
    for (const shortcut of EDITOR_COMMANDS.flatMap(command => command.shortcuts).filter(key => !key.includes("+")))
      expect(transportTarget(shortcut.length === 1 ? shortcut.toLowerCase() : shortcut, false, { timeMs: 0, durationMs: 1000, playing: false, rate: 1 }, 60), shortcut).toBeUndefined();
  });
  it("normalizes keyboard events", () => {
    const event = (key: string, mods: Partial<KeyboardEvent> = {}) => ({ key, code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
    expect(shortcutOf(event("k", { metaKey: true }))).toBe("Mod+K");
    expect(shortcutOf(event("Z", { ctrlKey: true, shiftKey: true }))).toBe("Mod+Shift+Z");
    expect(shortcutOf(event("y", { ctrlKey: true }))).toBe("Ctrl+Y");
    expect(shortcutOf(event("˚", { altKey: true, code: "KeyK" }))).toBe("Alt+K");
    expect(shortcutOf(event("F9", { shiftKey: true }))).toBe("Shift+F9");
    expect(shortcutOf(event("g"))).toBe("G");
  });
});
