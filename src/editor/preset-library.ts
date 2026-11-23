import { useEffect, useState } from "react";
import { PresetSchema, type Preset } from "../core";
import { useEditor } from "./context";

export function useProjectPresets() {
  const { client, hello } = useEditor();
  const [entries, setEntries] = useState<Preset[]>([]);
  const [problem, setProblem] = useState("");
  const [version, setVersion] = useState(0);
  const connected = !!client && !!hello?.capabilities.includes("presets");
  useEffect(() => {
    if (!client || !connected) return;
    let active = true;
    void client.listPresets().then(async items => {
      const results = await Promise.allSettled(items.filter(item => !item.issues?.length).map(async item => PresetSchema.parse((await client.readPreset(item.id)).preset)));
      if (!active) return;
      setEntries(results.flatMap(result => result.status === "fulfilled" ? [result.value] : []));
      const unavailable = items.length - results.filter(result => result.status === "fulfilled").length;
      setProblem(unavailable ? `${unavailable} preset files could not be loaded.` : "");
    }).catch(error => { if (active) setProblem((error as Error).message); });
    return () => { active = false; };
  }, [client, connected, version]);
  return { entries, problem, connected, reload: () => setVersion(value => value + 1) };
}
