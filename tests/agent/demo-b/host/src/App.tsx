import { createContext, useContext, useState, type ReactNode } from "react";
const DashboardContext = createContext("demo dashboard");
export function DashboardProvider({ children }: { children: ReactNode }) {
  return <DashboardContext.Provider value="demo dashboard">{children}</DashboardContext.Provider>;
}
export function App() {
  const title = useContext(DashboardContext);
  const [count, setCount] = useState(0);
  return <main style={{ padding: 24, minHeight: 200, background: "#101418", color: "#f2f5f7", fontFamily: "system-ui" }}>
    <h1>{title}</h1>
    <p>Revenue: 12840</p>
    <button onClick={() => setCount((c) => c + 1)}>Inspect {count}</button>
  </main>;
}
