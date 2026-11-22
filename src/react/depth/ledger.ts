/** SOURCE OF TRUTH: createStyleLedger.
 * WHAT: compose a limited set of inline styles with the host cascade and restore them exactly.
 * WHY: depth must leave the original DOM, style values and priorities intact.
 * WHERE: both volumetric and iframe renderers use this ledger for every host style write.
 */
export type DepthElement = Element & { style: CSSStyleDeclaration };
type Property = "transform" | "transform-style" | "backface-visibility" | "filter" | "box-shadow" | "background-image" | "background-size" | "background-position" | "background-repeat";
type StyleValue = string | { prepend: string; separator?: ", " | " " };
export type DepthStyles = Partial<Record<Property, StyleValue>>;
type Value = { value: string; priority: string };
type PropertyState = { before: Value; base: string; desired: StyleValue; applied?: Value; requested?: Value; conflicts: number };
type Entry = { original: string | null; signature: string; owned: Map<Property, PropertyState>; serialized: string | null; layoutStyle?: string; changedLayout?: boolean };
const active = new Set<() => void>();
const read = (element: DepthElement, property: Property): Value => ({ value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) });
const same = (a: Value, b?: Value) => !!b && a.value === b.value && a.priority === b.priority;
const signature = (style: CSSStyleDeclaration, owned?: Entry["owned"]) => JSON.stringify(Array.from(style).filter(name => !owned?.has(name as Property))
  .sort().map(name => [name, style.getPropertyValue(name), style.getPropertyPriority(name)]));
const composedBase = (value: string, css: CSSStyleDeclaration | undefined, property: Property) =>
  value && !/^(?:initial|inherit|unset|revert(?:-layer)?)$/.test(value) ? value : css?.getPropertyValue(property) || "";
const development = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

export function createStyleLedger(doc: Document, contested?: (element: DepthElement, property: Property) => void) {
  const memory = new WeakMap<DepthElement, Entry>();
  const touched = new Set<DepthElement>();
  const dirty = new Set<DepthElement>();
  const view = doc.defaultView;
  let frame: number | undefined;
  let restoredDifferences: DepthElement[] = [];
  const write = (element: DepthElement, property: Property, state: PropertyState) => {
    const desired = state.desired;
    const base = state.base && state.base !== "none" ? state.base : "";
    const value = typeof desired === "string" ? desired : desired.prepend + (base ? (desired.separator ?? " ") + base : "");
    // Use the host's inline priority. When the rule is from a stylesheet, the
    // ledger must also work for a host selector that uses !important.
    const priority = state.before.priority || "important";
    const current = read(element, property);
    const requested = { value, priority };
    if (same(current, state.applied) && same(requested, state.requested)) return;
    element.style.setProperty(property, value, priority);
    state.applied = read(element, property);
    state.requested = requested;
  };
  const refresh = (element: DepthElement, entry: Entry) => {
    for (const [property, state] of entry.owned) {
      const current = read(element, property);
      if (same(current, state.applied)) continue;
      state.before = current;
      state.base = composedBase(current.value, view?.getComputedStyle(element), property);
      if (++state.conflicts === 3) contested?.(element, property);
      write(element, property, state);
    }
    entry.serialized = element.getAttribute("style");
  };
  const collect = (records: MutationRecord[]) => {
    for (const record of records) {
      const element = record.target as DepthElement, entry = memory.get(element);
      if (entry && entry.serialized !== element.getAttribute("style")) dirty.add(element);
    }
  };
  const settle = () => {
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
    frame = undefined;
    collect(observer?.takeRecords() ?? []);
    for (const element of dirty) {
      const entry = memory.get(element);
      if (entry) refresh(element, entry);
    }
    dirty.clear();
  };
  const observer = view && typeof view.MutationObserver !== "undefined" ? new view.MutationObserver(records => {
    collect(records);
    if (dirty.size && frame === undefined) frame = view.requestAnimationFrame(settle);
  }) : undefined;
  const restore = (element: DepthElement) => {
    const entry = memory.get(element);
    if (!entry) return;
    const unchanged = entry.owned.size > 0 && !entry.changedLayout && signature(element.style, entry.owned) === entry.layoutStyle &&
      [...entry.owned].every(([property, state]) => !state.conflicts && same(read(element, property), state.applied));
    for (const [property, state] of entry.owned) {
      if (!same(read(element, property), state.applied)) continue;
      if (state.before.value) element.style.setProperty(property, state.before.value, state.before.priority);
      else element.style.removeProperty(property);
    }
    // CSSOM normalizes quoting, whitespace and property order. Restore the raw
    // attribute when the declaration set still matches the original host styles.
    if (unchanged || signature(element.style) === entry.signature) {
      if (entry.original === null) element.removeAttribute("style");
      else element.setAttribute("style", entry.original);
    }
    entry.serialized = element.getAttribute("style");
    entry.owned.clear();
  };
  const differs = (element: DepthElement) => memory.get(element)?.original !== element.getAttribute("style");
  const audit = () => [...new Set([...touched, ...restoredDifferences])].filter(differs);
  const revert = () => {
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
    frame = undefined;
    observer?.disconnect();
    dirty.clear();
    for (const element of touched) restore(element);
    if (touched.size) restoredDifferences = [...touched].filter(differs);
    touched.clear();
    if (development && restoredDifferences.some(element => signature(element.style) === memory.get(element)?.signature))
      console.warn("Velora depth could not restore an inline style attribute exactly.");
    view?.removeEventListener("pagehide", revert);
    active.delete(revert);
  };
  return {
    clear(element: DepthElement, property: Property) {
      const entry = memory.get(element);
      const state = entry?.owned.get(property);
      if (!entry || !state) return;
      if (entry.owned.size === 1) { restore(element); return; }
      const ours = same(read(element, property), state.applied);
      entry.changedLayout ||= !ours || state.conflicts > 0 || signature(element.style, entry.owned) !== entry.layoutStyle;
      if (ours) {
        if (state.before.value) element.style.setProperty(property, state.before.value, state.before.priority);
        else element.style.removeProperty(property);
      }
      entry.owned.delete(property);
      entry.layoutStyle = signature(element.style, entry.owned);
      entry.serialized = element.getAttribute("style");
    },
    apply(element: DepthElement, props: DepthStyles) {
      let entry = memory.get(element);
      if (!entry || !entry.owned.size) {
        const original = element.getAttribute("style");
        entry = { original, signature: signature(element.style), owned: new Map(), serialized: original };
        memory.set(element, entry);
        touched.add(element);
        observer?.observe(element, { attributes: true, attributeFilter: ["style"] });
        view?.addEventListener("pagehide", revert);
        active.add(revert);
      }
      const previousProperties = entry.owned.size;
      const properties = Object.entries(props) as [Property, StyleValue][];
      const css = properties.some(([property, value]) => !entry.owned.has(property) && typeof value !== "string") ? view?.getComputedStyle(element) : undefined;
      for (const [property, desired] of properties) {
        let state = entry.owned.get(property);
        const current = read(element, property);
        if (!state) {
          state = { before: current, base: composedBase(current.value, css, property), desired, conflicts: 0 };
          entry.owned.set(property, state);
        } else if (!same(current, state.applied)) {
          state.before = current;
          state.base = composedBase(current.value, view?.getComputedStyle(element), property);
          if (++state.conflicts === 3) contested?.(element, property);
        }
        state.desired = desired;
        write(element, property, state);
      }
      entry.serialized = element.getAttribute("style");
      if (previousProperties !== entry.owned.size) entry.layoutStyle = signature(element.style, entry.owned);
    },
    ownsCurrentStyle(element: Element) {
      const host = element as DepthElement;
      const entry = memory.get(host);
      return !!entry && (entry.serialized === host.getAttribute("style") || entry.layoutStyle === signature(host.style, entry.owned));
    },
    settle, revert, audit,
  };
}

import.meta.hot?.dispose(() => { for (const revert of active) revert(); });
