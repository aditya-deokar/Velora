import { VeloraProjectPreview } from "./velora/ProjectPreview";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<VeloraProjectPreview projectId="b46d4fe9-fcc8-40b5-914f-ac5835d8c29d" enabled={import.meta.env.DEV}>{<App />}</VeloraProjectPreview>);
