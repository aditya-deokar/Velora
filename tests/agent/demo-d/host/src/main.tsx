import { createRoot } from "react-dom/client";
import { WorkspaceProvider, App } from "./App";
// Existing provider composition must survive initialization.
createRoot(document.getElementById("root")!).render(
  <WorkspaceProvider><App /></WorkspaceProvider>
);
