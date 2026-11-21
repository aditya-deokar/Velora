import { parseJsonDocument, type EditOp } from "../core";
import type { Doc, EditorWriter } from "./store";

/** Edit bridge client (protocol v1, see project/services/bridge.ts). The token arrives in the URL
 * fragment, which is removed at once with history.replaceState so it never appears in copied URLs or
 * screenshots. Events use a streaming fetch reader because EventSource cannot send an Authorization header. */
export type BridgeAddress = { port: number; token: string };
export type BridgeHello = { protocol: number; version: string; projectId?: string; readOnly: boolean; capabilities: string[]; fileKinds: string[] };
export function parseBridgeFragment(hash: string): BridgeAddress | undefined {
  const match = /^#velora-bridge=(\d{1,5})\.([A-Za-z0-9_-]{16,128})$/.exec(hash);
  if (!match) return undefined;
  const port = Number(match[1]);
  return port > 0 && port < 65536 ? { port, token: match[2] } : undefined;
}
/** Read the bridge address from location.hash and strip the fragment. */
export function takeBridgeFragment(): BridgeAddress | undefined {
  if (typeof location === "undefined") return undefined;
  const address = parseBridgeFragment(location.hash);
  if (location.hash.startsWith("#velora-bridge=") && typeof history !== "undefined")
    history.replaceState(history.state, "", location.pathname + location.search);
  return address;
}
type Fetch = typeof fetch;
export type BridgeEvent = { event: string; data: unknown };
export function createBridgeClient(address: BridgeAddress, fetchImpl: Fetch = (...args) => fetch(...args)) {
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: `Bearer ${address.token}` };
  const json = async (path: string, init: RequestInit = {}) => {
    const response = await fetchImpl(origin + path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  };
  return {
    origin,
    async hello(): Promise<BridgeHello> {
      const reply = await json("/v1/hello");
      if (reply.status !== 200) throw new Error(`Bridge refused hello (HTTP ${reply.status}).`);
      return reply.body as unknown as BridgeHello;
    },
    async readScene(id: string): Promise<{ text: string; sha: string; doc: Doc }> {
      const reply = await json(`/v1/scenes/${encodeURIComponent(id)}`);
      if (reply.status !== 200) throw new Error(`Bridge could not read scene ${id} (HTTP ${reply.status}).`);
      return { text: reply.body.text as string, sha: reply.body.sha256 as string, doc: parseJsonDocument(reply.body.text as string) as Doc };
    },
    /** The store's writer: one batch per call, compare-and-swap against baseSha. */
    writer(id: string): EditorWriter {
      return async (baseSha: string, ops: EditOp[], label: string) => {
        try {
          const reply = await json(`/v1/scenes/${encodeURIComponent(id)}/edits`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseSha, ops, label: label.slice(0, 200) }) });
          if (reply.status === 200) return { status: "ok", sha: reply.body.sha as string };
          if (reply.status === 409 && typeof reply.body.text === "string") return { status: "conflict", sha: reply.body.sha as string, text: reply.body.text, doc: parseJsonDocument(reply.body.text) as Doc };
          if (reply.status === 422 || reply.status === 413) return { status: "invalid", issues: (reply.body.issues as never) ?? [{ code: "ERR_EDIT_INVALID", path: "ops", message: String(reply.body.error ?? "Refused by the bridge.") }] };
          return { status: "offline" };
        } catch { return { status: "offline" }; }
      };
    },
    /** Project presets (07.6): list, read and save with compare-and-swap (baseSha null creates). */
    async listPresets(): Promise<{ id: string; title?: string; kind?: string; sha: string; issues?: unknown[] }[]> {
      const reply = await json("/v1/presets");
      if (reply.status !== 200) throw new Error(`Bridge could not list presets (HTTP ${reply.status}).`);
      return (reply.body.presets as never) ?? [];
    },
    async readPreset(id: string): Promise<{ sha: string; preset: Record<string, unknown> }> {
      const reply = await json(`/v1/presets/${encodeURIComponent(id)}`);
      if (reply.status !== 200) throw new Error(`Bridge could not read preset ${id} (HTTP ${reply.status}).`);
      return { sha: reply.body.sha256 as string, preset: reply.body.preset as Record<string, unknown> };
    },
    async writePreset(preset: { id: string } & Record<string, unknown>, baseSha: string | null): Promise<{ status: "ok"; sha: string } | { status: "conflict"; sha: string | null } | { status: "invalid"; message: string }> {
      const reply = await json(`/v1/presets/${encodeURIComponent(preset.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseSha, preset }) });
      if (reply.status === 200) return { status: "ok", sha: reply.body.sha as string };
      if (reply.status === 409) return { status: "conflict", sha: (reply.body.sha as string | null) ?? null };
      return { status: "invalid", message: String((reply.body.issues as { message?: string }[] | undefined)?.[0]?.message ?? reply.body.error ?? `HTTP ${reply.status}`) };
    },
    /** Stream events until the signal aborts or the bridge closes. */
    async events(onEvent: (event: BridgeEvent) => void, signal: AbortSignal): Promise<void> {
      const response = await fetchImpl(origin + "/v1/events", { headers, signal });
      if (!response.ok || !response.body) throw new Error(`Bridge events unavailable (HTTP ${response.status}).`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let split: number;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event) { try { onEvent({ event, data: data ? JSON.parse(data) : null }); } catch { /* ignore a malformed frame */ } }
        }
      }
    },
  };
}
export type BridgeClient = ReturnType<typeof createBridgeClient>;
