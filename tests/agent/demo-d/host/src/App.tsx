import { createContext, useContext, useState, type ReactNode } from "react";
// Fixture SaaS product (fictional): a metrics dashboard with an existing provider.
const WorkspaceContext = createContext("Fieldnote");
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  return <WorkspaceContext.Provider value="Fieldnote">{children}</WorkspaceContext.Provider>;
}
const KPIS = [["Active teams", "1,284"], ["Weekly reports", "9,630"], ["Median time to insight", "4.2 min"]];
const BARS = [38, 52, 47, 63, 71, 66, 84, 92];
export function App() {
  const product = useContext(WorkspaceContext);
  const [range, setRange] = useState("8 weeks");
  return <main style={{ minHeight: "100vh", padding: 32, background: "#0d1117", color: "#e6edf3", fontFamily: "system-ui, sans-serif" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>{product} <span style={{ color: "#7ee0b5" }}>Insights</span></h1>
      <button onClick={() => setRange(range === "8 weeks" ? "12 months" : "8 weeks")} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #30363d", background: "#161b22", color: "#e6edf3" }}>{range}</button>
    </header>
    <section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 24 }}>
      {KPIS.map(([label, value]) => <article key={label} style={{ padding: 20, borderRadius: 14, background: "#161b22", border: "1px solid #30363d" }}>
        <p style={{ margin: 0, color: "#8b949e" }}>{label}</p><p style={{ margin: "8px 0 0", fontSize: 32, fontWeight: 700 }}>{value}</p>
      </article>)}
    </section>
    <section style={{ marginTop: 24, padding: 20, borderRadius: 14, background: "#161b22", border: "1px solid #30363d" }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Reports shipped</h2>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 180, marginTop: 16 }}>
        {BARS.map((height, index) => <div key={index} style={{ flex: 1, height: `${height}%`, borderRadius: 6, background: "linear-gradient(#7ee0b5, #2f81f7)" }} />)}
      </div>
    </section>
    <section style={{ marginTop: 24, padding: 20, borderRadius: 14, background: "#122117", border: "1px solid #2ea04366" }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>New: Auto-summaries</h2>
      <p style={{ margin: "8px 0 0", color: "#8b949e" }}>Every dashboard now writes its own weekly summary.</p>
    </section>
  </main>;
}
